import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { REFILL_TEMPLATE_NAME } from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { REDIS } from "../../common/redis.module";
import {
  SMS_PROVIDER,
  WA_PROVIDER,
  type MessagingProvider,
} from "./providers/messaging-provider.interface";
import { delayUntilWindowOpenMs } from "./quiet-hours";

const HOUR_MS = 60 * 60 * 1000;
export const FALLBACK_DELAY_MS = 6 * HOUR_MS; // docs/04 Flow 2
export const FINAL_CHECK_DELAY_MS = 2 * HOUR_MS;

export type SendOutcome =
  | { kind: "sent"; messageId: string; fallbackCheckDelayMs: number }
  | { kind: "skipped_optout"; messageId: string }
  | { kind: "skipped_cap" }
  | { kind: "delayed"; delayMs: number }
  | { kind: "failed_now"; messageId: string; fallbackCheckDelayMs: number }
  | { kind: "not_found" };

export type CampaignSendOutcome =
  | { kind: "sent"; messageId: string }
  | { kind: "skipped_optout"; messageId: string }
  | { kind: "skipped_cap" }
  | { kind: "delayed"; delayMs: number }
  | { kind: "failed"; messageId: string }
  | { kind: "not_found" };

export type FallbackOutcome =
  | { kind: "already_delivered" }
  | { kind: "sms_sent"; messageId: string; finalCheckDelayMs: number }
  | { kind: "sms_skipped_optout" }
  | { kind: "delayed"; delayMs: number }
  | { kind: "reminder_failed" }
  | { kind: "not_found" };

const capKey = (pharmacyId: string, at: Date) =>
  `remcap:${pharmacyId}:${at.toISOString().slice(0, 7)}`; // YYYY-MM

/** Rendered SMS body (≤2 Arabic segments) — same info as the WA template. */
const smsBody = (customerName: string, productName: string, pharmacyName: string) =>
  `${customerName}، دواؤك ${productName} قارب على الانتهاء. في انتظارك في ${pharmacyName}.`;

/**
 * Reminder send pipeline (docs/04 Flow 2). All DB access via service-bypass
 * RLS transactions — jobs run outside any request/tenant context.
 * Pre-send gate order (docs/05 §4): opt-out → quiet hours → cap → template.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WA_PROVIDER) private readonly wa: MessagingProvider,
    @Inject(SMS_PROVIDER) private readonly sms: MessagingProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Monthly reminder counter (R1). Returns true when the cap is exhausted. */
  async isCapReached(pharmacyId: string, cap: number): Promise<boolean> {
    const used = Number((await this.redis.get(capKey(pharmacyId, new Date()))) ?? 0);
    return used >= cap;
  }

  private async incrementCap(pharmacyId: string): Promise<void> {
    const key = capKey(pharmacyId, new Date());
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 40 * 24 * 60 * 60); // key dies after the month
  }

  /** Send (or gate) the WhatsApp reminder for a Reminder row. */
  async sendReminder(
    reminderId: string,
    opts: { bypassQuietHours?: boolean } = {},
  ): Promise<SendOutcome> {
    const ctx = await this.prisma.withServiceBypass(async (tx) => {
      const reminder = await tx.reminder.findUnique({
        where: { id: reminderId },
        include: {
          refillRule: {
            include: {
              customer: { include: { pharmacy: true } },
              productRef: true,
            },
          },
        },
      });
      return reminder;
    });
    if (!ctx || !["PENDING", "SNOOZED"].includes(ctx.status)) return { kind: "not_found" };

    const customer = ctx.refillRule.customer;
    const pharmacy = customer.pharmacy;
    const product = ctx.refillRule.productRef;

    // ---- gate 1: opt-out (R3) — record the skip, NEVER call the provider ----
    if (customer.optedOutAt) {
      const msg = await this.prisma.withServiceBypass((tx) =>
        tx.message.create({
          data: {
            pharmacyId: pharmacy.id,
            customerId: customer.id,
            reminderId,
            channel: "WHATSAPP",
            templateName: REFILL_TEMPLATE_NAME,
            bodyText: smsBody(customer.name, product.nameText, pharmacy.name),
            status: "SKIPPED_OPTOUT",
          },
        }),
      );
      return { kind: "skipped_optout", messageId: msg.id };
    }

    // ---- gate 2: quiet hours (R2) — reschedule, don't skip ----
    if (!opts.bypassQuietHours) {
      const delayMs = delayUntilWindowOpenMs(new Date(), pharmacy.quietStart, pharmacy.quietEnd);
      if (delayMs > 0) return { kind: "delayed", delayMs };
    }

    // ---- gate 3: monthly cap (R1) — skip + notify owner ----
    if (await this.isCapReached(pharmacy.id, pharmacy.monthlyReminderCap)) {
      this.logger.warn(
        `Reminder cap reached for pharmacy ${pharmacy.id} (${pharmacy.monthlyReminderCap}/mo) — owner should upgrade`,
      );
      // TODO(Session 7/8): surface as in-app owner notification + upgrade prompt
      return { kind: "skipped_cap" };
    }

    // ---- gate 4: WA without template = bug — enforced by provider + here ----
    const templateName = REFILL_TEMPLATE_NAME;

    const message = await this.prisma.withServiceBypass((tx) =>
      tx.message.create({
        data: {
          pharmacyId: pharmacy.id,
          customerId: customer.id,
          reminderId,
          channel: "WHATSAPP",
          templateName,
          templateParams: { name: customer.name, product: product.nameText, pharmacy: pharmacy.name },
          bodyText: smsBody(customer.name, product.nameText, pharmacy.name),
          status: "QUEUED",
        },
      }),
    );

    try {
      const { providerRef } = await this.wa.send({
        to: customer.phone,
        templateName,
        templateParams: { name: customer.name, product: product.nameText, pharmacy: pharmacy.name },
      });
      await this.prisma.withServiceBypass(async (tx) => {
        await tx.message.update({
          where: { id: message.id },
          data: { providerRef, status: "SENT", sentAt: new Date() },
        });
        await tx.reminder.update({ where: { id: reminderId }, data: { status: "SENT" } });
      });
      await this.incrementCap(pharmacy.id);
      return { kind: "sent", messageId: message.id, fallbackCheckDelayMs: FALLBACK_DELAY_MS };
    } catch (e) {
      this.logger.error(`WA send failed for reminder ${reminderId}: ${String(e)}`);
      await this.prisma.withServiceBypass((tx) =>
        tx.message.update({
          where: { id: message.id },
          data: { status: "FAILED", failedAt: new Date() },
        }),
      );
      // WA hard-failed → let the fallback path run promptly instead of +6h
      return { kind: "failed_now", messageId: message.id, fallbackCheckDelayMs: 60_000 };
    }
  }

  /**
   * Campaign send — same pre-send gate order as reminders (docs/05 §4):
   * opt-out → quiet hours → monthly cap → approved template. WA-only in V1
   * (SMS fallback for campaigns is priced into estimates but deferred).
   * Renders {{name}}/{{pharmacy}}/{{points}} plus campaign params.
   */
  async sendCampaignMessage(campaignId: string, customerId: string): Promise<CampaignSendOutcome> {
    const ctx = await this.prisma.withServiceBypass(async (tx) => {
      const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        include: { pharmacy: true },
      });
      return { campaign, customer };
    });
    if (!ctx.campaign || !ctx.customer || ctx.customer.deletedAt) return { kind: "not_found" };
    const { campaign, customer } = ctx;
    const pharmacy = customer.pharmacy;

    const templateParams = {
      name: customer.name,
      pharmacy: pharmacy.name,
      points: String(customer.pointsBalance),
      ...((campaign.templateParams as Record<string, string> | null) ?? {}),
    };
    const bodyText = campaign.templateSms
      .replace(/\{\{name\}\}/g, customer.name)
      .replace(/\{\{pharmacy\}\}/g, pharmacy.name)
      .replace(/\{\{points\}\}/g, String(customer.pointsBalance));

    // gate 1: opt-out (R3) — record the skip, NEVER call the provider
    if (customer.optedOutAt) {
      const msg = await this.prisma.withServiceBypass((tx) =>
        tx.message.create({
          data: {
            pharmacyId: pharmacy.id,
            customerId: customer.id,
            campaignId,
            channel: "WHATSAPP",
            templateName: campaign.templateName,
            bodyText,
            status: "SKIPPED_OPTOUT",
          },
        }),
      );
      return { kind: "skipped_optout", messageId: msg.id };
    }

    // gate 2: quiet hours (R2) — caller reschedules the whole batch
    const delayMs = delayUntilWindowOpenMs(new Date(), pharmacy.quietStart, pharmacy.quietEnd);
    if (delayMs > 0) return { kind: "delayed", delayMs };

    // gate 3: monthly cap (R1) — campaigns share the reminder cap
    if (await this.isCapReached(pharmacy.id, pharmacy.monthlyReminderCap)) {
      this.logger.warn(`Campaign ${campaignId}: cap reached for pharmacy ${pharmacy.id} — stopping batch`);
      return { kind: "skipped_cap" };
    }

    const message = await this.prisma.withServiceBypass((tx) =>
      tx.message.create({
        data: {
          pharmacyId: pharmacy.id,
          customerId: customer.id,
          campaignId,
          channel: "WHATSAPP",
          templateName: campaign.templateName, // gate 4: WA always template-backed (R4)
          templateParams,
          bodyText,
          status: "QUEUED",
        },
      }),
    );
    try {
      const { providerRef } = await this.wa.send({
        to: customer.phone,
        templateName: campaign.templateName,
        templateParams,
      });
      await this.prisma.withServiceBypass((tx) =>
        tx.message.update({
          where: { id: message.id },
          data: { providerRef, status: "SENT", sentAt: new Date() },
        }),
      );
      await this.incrementCap(pharmacy.id);
      return { kind: "sent", messageId: message.id };
    } catch (e) {
      this.logger.error(`Campaign WA send failed (${campaignId}/${customer.id}): ${String(e)}`);
      await this.prisma.withServiceBypass((tx) =>
        tx.message.update({
          where: { id: message.id },
          data: { status: "FAILED", failedAt: new Date() },
        }),
      );
      return { kind: "failed", messageId: message.id };
    }
  }

  /** +6h after WA send: DELIVERED/READ → done; else SMS fallback (docs/04 Flow 2). */
  async runFallbackCheck(
    waMessageId: string,
    opts: { bypassQuietHours?: boolean } = {},
  ): Promise<FallbackOutcome> {
    const waMsg = await this.prisma.withServiceBypass((tx) =>
      tx.message.findUnique({
        where: { id: waMessageId },
        include: { customer: { include: { pharmacy: true } }, reminder: true },
      }),
    );
    if (!waMsg || !waMsg.reminderId) return { kind: "not_found" };
    if (["DELIVERED", "READ"].includes(waMsg.status)) return { kind: "already_delivered" };
    if (waMsg.reminder?.status === "CONVERTED") return { kind: "already_delivered" };

    const { customer } = waMsg;
    const pharmacy = customer.pharmacy;

    if (!pharmacy.smsFallback) {
      await this.prisma.withServiceBypass((tx) =>
        tx.reminder.update({ where: { id: waMsg.reminderId! }, data: { status: "FAILED" } }),
      );
      return { kind: "reminder_failed" };
    }

    // gate again for the SMS leg
    if (customer.optedOutAt) {
      await this.prisma.withServiceBypass((tx) =>
        tx.message.update({ where: { id: waMessageId }, data: { status: "FALLBACK_TRIGGERED" } }),
      );
      return { kind: "sms_skipped_optout" };
    }
    if (!opts.bypassQuietHours) {
      const delayMs = delayUntilWindowOpenMs(new Date(), pharmacy.quietStart, pharmacy.quietEnd);
      if (delayMs > 0) return { kind: "delayed", delayMs };
    }

    await this.prisma.withServiceBypass((tx) =>
      tx.message.update({ where: { id: waMessageId }, data: { status: "FALLBACK_TRIGGERED" } }),
    );
    const smsMsg = await this.prisma.withServiceBypass((tx) =>
      tx.message.create({
        data: {
          pharmacyId: pharmacy.id,
          customerId: customer.id,
          reminderId: waMsg.reminderId,
          channel: "SMS",
          bodyText: waMsg.bodyText,
          status: "QUEUED",
        },
      }),
    );
    try {
      const { providerRef } = await this.sms.send({ to: customer.phone, bodyText: waMsg.bodyText });
      await this.prisma.withServiceBypass((tx) =>
        tx.message.update({
          where: { id: smsMsg.id },
          data: { providerRef, status: "SENT", sentAt: new Date() },
        }),
      );
      return { kind: "sms_sent", messageId: smsMsg.id, finalCheckDelayMs: FINAL_CHECK_DELAY_MS };
    } catch (e) {
      this.logger.error(`SMS fallback failed for message ${smsMsg.id}: ${String(e)}`);
      await this.prisma.withServiceBypass(async (tx) => {
        await tx.message.update({
          where: { id: smsMsg.id },
          data: { status: "FAILED", failedAt: new Date() },
        });
        await tx.reminder.update({ where: { id: waMsg.reminderId! }, data: { status: "FAILED" } });
      });
      return { kind: "reminder_failed" };
    }
  }

  /** +2h after SMS: not delivered → Reminder FAILED (red row S41). */
  async runFinalCheck(smsMessageId: string): Promise<"ok" | "reminder_failed" | "not_found"> {
    const smsMsg = await this.prisma.withServiceBypass((tx) =>
      tx.message.findUnique({ where: { id: smsMessageId } }),
    );
    if (!smsMsg || !smsMsg.reminderId) return "not_found";
    if (["DELIVERED", "READ"].includes(smsMsg.status)) return "ok";
    await this.prisma.withServiceBypass(async (tx) => {
      await tx.message.update({
        where: { id: smsMessageId },
        data: { status: "FAILED", failedAt: new Date() },
      });
      await tx.reminder.update({ where: { id: smsMsg.reminderId! }, data: { status: "FAILED" } });
    });
    return "reminder_failed";
  }
}
