import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ERROR_CODES,
  type CreateRefillRuleInput,
  type RefillsQueueQuery,
  type SnoozeInput,
  type UpdateRefillRuleInput,
} from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { QueueService } from "../../jobs/queue.service";
import { MessagingService } from "../messaging/messaging.service";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RefillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly queues: QueueService,
  ) {}

  /** POST /customers/:id/refill-rules — computes nextDueAt = now + cycleDays. */
  async createRule(customerId: string, input: CreateRefillRuleInput) {
    const customer = await this.prisma.tenant.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) this.notFound("Customer");
    const product = await this.prisma.tenant.productRef.findFirst({
      where: { id: input.productRefId },
      select: { id: true },
    });
    if (!product) this.notFound("ProductRef");

    return this.prisma.tenant.refillRule.create({
      data: {
        customerId,
        productRefId: input.productRefId,
        cycleDays: input.cycleDays,
        remindDaysBefore: input.remindDaysBefore ?? 2,
        autoSend: input.autoSend ?? true,
        nextDueAt: new Date(Date.now() + input.cycleDays * DAY_MS),
      },
      include: { productRef: { select: { id: true, nameText: true } } },
    });
  }

  /** PATCH /refill-rules/:id — edit / toggle / soft delete. */
  async updateRule(id: string, input: UpdateRefillRuleInput) {
    const rule = await this.prisma.tenant.refillRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) this.notFound("RefillRule");
    const { deleted, ...fields } = input;
    return this.prisma.tenant.refillRule.update({
      where: { id },
      data: {
        ...fields,
        ...(deleted ? { deletedAt: new Date(), isActive: false } : {}),
        // cycle change recomputes the horizon from now (simplest correct rule)
        ...(input.cycleDays && !deleted
          ? { nextDueAt: new Date(Date.now() + input.cycleDays * DAY_MS) }
          : {}),
      },
      include: { productRef: { select: { id: true, nameText: true } } },
    });
  }

  /**
   * GET /refills/queue?bucket=overdue|today|week (S41).
   * overdue: dueAt < today-start, not terminal
   * today:   today-start ≤ dueAt < tomorrow-start
   * week:    tomorrow-start ≤ dueAt < +7d
   */
  async queue(q: RefillsQueueQuery) {
    const now = new Date();
    const todayStart = new Date(now); // server tz ≈ Cairo deploy; buckets are coarse
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const weekEnd = new Date(todayStart.getTime() + 8 * DAY_MS);

    const dueAt =
      q.bucket === "overdue"
        ? { lt: todayStart }
        : q.bucket === "today"
          ? { gte: todayStart, lt: tomorrowStart }
          : { gte: tomorrowStart, lt: weekEnd };

    const rows = await this.prisma.tenant.reminder.findMany({
      where: {
        dueAt,
        status: { in: ["PENDING", "SENT", "FAILED", "SNOOZED"] },
        refillRule: { deletedAt: null, customer: { deletedAt: null } },
      },
      orderBy: { dueAt: "asc" },
      take: 200,
      include: {
        refillRule: {
          include: {
            customer: { select: { id: true, name: true, phone: true, optedOutAt: true } },
            productRef: { select: { id: true, nameText: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { channel: true, status: true },
        },
      },
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        dueAt: r.dueAt,
        status: r.status,
        customer: r.refillRule.customer,
        product: r.refillRule.productRef,
        cycleDays: r.refillRule.cycleDays,
        lastMessage: r.messages[0] ?? null,
      })),
    };
  }

  /** POST /reminders/:id/send-now — bypasses quiet hours; opt-out + template rules still apply. */
  async sendNow(id: string) {
    await this.ensureReminderInTenant(id);
    const outcome = await this.messaging.sendReminder(id, { bypassQuietHours: true });
    if (outcome.kind === "not_found") {
      throw new ConflictException({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Reminder is not sendable in its current state" },
      });
    }
    if (outcome.kind === "sent" || outcome.kind === "failed_now") {
      await this.queues.enqueueFallbackCheck(
        { step: "wa-check", messageId: outcome.messageId },
        outcome.fallbackCheckDelayMs,
      );
    }
    return { outcome: outcome.kind };
  }

  /** POST /reminders/:id/mark-purchased (R12) — manual conversion. */
  async markPurchased(id: string) {
    const reminder = await this.ensureReminderInTenant(id);
    if (["CONVERTED", "CANCELLED"].includes(reminder.status)) {
      return { status: reminder.status };
    }
    await this.prisma.withTenantRls(async (tx) => {
      await tx.reminder.update({ where: { id }, data: { status: "CONVERTED" } });
      const rule = await tx.refillRule.findUniqueOrThrow({ where: { id: reminder.refillRuleId } });
      await tx.refillRule.update({
        where: { id: rule.id },
        data: { nextDueAt: new Date(Date.now() + rule.cycleDays * DAY_MS) },
      });
    });
    return { status: "CONVERTED" };
  }

  /** POST /reminders/:id/snooze {days} — shifts dueAt, status SNOOZED. */
  async snooze(id: string, input: SnoozeInput) {
    const reminder = await this.ensureReminderInTenant(id);
    if (["CONVERTED", "CANCELLED"].includes(reminder.status)) {
      throw new ConflictException({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Reminder already closed" },
      });
    }
    const newDueAt = new Date(reminder.dueAt.getTime() + input.days * DAY_MS);
    await this.prisma.tenant.reminder.update({
      where: { id },
      data: { status: "SNOOZED", dueAt: newDueAt },
    });
    return { status: "SNOOZED", dueAt: newDueAt };
  }

  private async ensureReminderInTenant(id: string) {
    const reminder = await this.prisma.tenant.reminder.findFirst({
      where: { id, refillRule: { deletedAt: null, customer: { deletedAt: null } } },
    });
    if (!reminder) this.notFound("Reminder");
    return reminder!;
  }

  private notFound(what: string): never {
    throw new NotFoundException({
      error: { code: ERROR_CODES.NOT_FOUND, message: `${what} not found` },
    });
  }
}
