import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { isOptOutText } from "@pharmacrm/shared";
import { Public } from "../../../common/guards/jwt.guard";
import { PrismaService } from "../../../common/prisma.service";

/** Meta status → our MessageStatus + timestamp column. */
const STATUS_MAP: Record<string, { status: "SENT" | "DELIVERED" | "READ" | "FAILED"; at: "sentAt" | "deliveredAt" | "readAt" | "failedAt" }> = {
  sent: { status: "SENT", at: "sentAt" },
  delivered: { status: "DELIVERED", at: "deliveredAt" },
  read: { status: "READ", at: "readAt" },
  failed: { status: "FAILED", at: "failedAt" },
};

/**
 * docs/05 §4 — WA Cloud API webhook.
 * SECURITY ORDER IS FIXED: X-Hub-Signature-256 verified BEFORE any DB access.
 * Needs express rawBody (main.ts) because the HMAC covers the raw bytes.
 */
@Public()
@Controller("webhooks/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Meta subscription handshake: echo hub.challenge. */
  @Get()
  verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ): string {
    if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) return challenge;
    throw new UnauthorizedException();
  }

  @Post()
  async handle(@Req() req: Request & { rawBody?: Buffer }) {
    // ---- 1. signature FIRST — no DB before this line ----
    const secret = process.env.WA_APP_SECRET;
    if (!secret) throw new UnauthorizedException("WA_APP_SECRET not configured");
    const signature = req.headers["x-hub-signature-256"];
    const raw = req.rawBody;
    if (typeof signature !== "string" || !raw) throw new UnauthorizedException();
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();

    // ---- 2. parse ----
    const body = req.body as {
      entry?: {
        changes?: {
          value?: {
            statuses?: { id: string; status: string; timestamp?: string }[];
            messages?: { from: string; text?: { body?: string } }[];
            metadata?: { phone_number_id?: string };
          };
        }[];
      }[];
    };
    if (!body?.entry) throw new BadRequestException();

    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // ---- status updates → Message by providerRef ----
        for (const s of value.statuses ?? []) {
          const mapped = STATUS_MAP[s.status];
          if (!mapped) continue;
          await this.prisma.withServiceBypass(async (tx) => {
            const updated = await tx.message.updateMany({
              where: { providerRef: s.id },
              data: { status: mapped.status, [mapped.at]: new Date() },
            });
            if (updated.count === 0) {
              this.logger.warn(`WA status for unknown providerRef ${s.id}`);
            }
          });
        }

        // ---- inbound messages → opt-out keywords (R3) ----
        for (const m of value.messages ?? []) {
          const text = m.text?.body ?? "";
          const phone = `+${m.from}`;
          if (isOptOutText(text)) {
            await this.prisma.withServiceBypass(async (tx) => {
              const res = await tx.customer.updateMany({
                where: { phone, optedOutAt: null },
                data: { optedOutAt: new Date() },
              });
              this.logger.log(`Opt-out from ${phone} → ${res.count} customer row(s) updated`);
            });
          } else {
            // other replies stored for reports (docs/05 §4) — Session 7 scope;
            // log for now so nothing is silently dropped
            this.logger.log(`WA inbound (non-optout) from ${phone}: ${text.slice(0, 80)}`);
          }
        }
      }
    }
    return { received: true };
  }
}
