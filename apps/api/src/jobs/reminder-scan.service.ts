import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { QueueService } from "./queue.service";

/**
 * docs/04 Flow 2, cron q15min:
 * RefillRule active + autoSend + not deleted + (nextDueAt − remindDaysBefore ≤ now)
 * AND no Reminder yet for (ruleId, nextDueAt) → INSERT Reminder(PENDING) → enqueue send.
 * Dedup: DB @@unique([refillRuleId, dueAt]) (R10) — the create silently skips on conflict.
 */
@Injectable()
export class ReminderScanService {
  private readonly logger = new Logger(ReminderScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async scan(now = new Date()): Promise<{ created: number }> {
    const dueRules = await this.prisma.withServiceBypass((tx) =>
      tx.$queryRaw<{ id: string; nextDueAt: Date }[]>`
        SELECT rr.id, rr."nextDueAt"
        FROM "RefillRule" rr
        JOIN "Customer" c ON c.id = rr."customerId"
        WHERE rr."isActive" = true
          AND rr."autoSend" = true
          AND rr."deletedAt" IS NULL
          AND c."deletedAt" IS NULL
          AND rr."nextDueAt" - (rr."remindDaysBefore" * interval '1 day') <= ${now}
          AND NOT EXISTS (
            SELECT 1 FROM "Reminder" rem
            WHERE rem."refillRuleId" = rr.id AND rem."dueAt" = rr."nextDueAt"
          )
        LIMIT 500`,
    );

    let created = 0;
    for (const rule of dueRules) {
      try {
        const reminder = await this.prisma.withServiceBypass((tx) =>
          tx.reminder.create({
            data: { refillRuleId: rule.id, dueAt: rule.nextDueAt, status: "PENDING" },
          }),
        );
        created++;
        await this.queues.enqueueSend({ reminderId: reminder.id });
      } catch {
        // unique (refillRuleId, dueAt) race with another scan — safe to ignore (R10)
      }
    }
    if (created > 0) this.logger.log(`Reminder scan: ${created} reminder(s) created`);
    return { created };
  }
}
