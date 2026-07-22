import { Body, Controller, Logger, Post, UnauthorizedException, Headers } from "@nestjs/common";
import { Public } from "../../../common/guards/jwt.guard";
import { PrismaService } from "../../../common/prisma.service";

/**
 * SMS gateway DLR webhook, normalized to {providerRef, status} inside this
 * controller (gateway-specific shape is adapted here — docs/05 §4).
 * Auth: shared secret header until the real gateway's scheme is known
 * (external-setup.md).
 */
@Public()
@Controller("webhooks/sms")
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async handle(
    @Headers("x-sms-secret") secret: string | undefined,
    @Body() body: { providerRef?: string; ref?: string; status?: string },
  ) {
    // ---- auth first, no DB before ----
    if (!process.env.SMS_API_KEY || secret !== process.env.SMS_API_KEY) {
      throw new UnauthorizedException();
    }

    const providerRef = body.providerRef ?? body.ref;
    const raw = (body.status ?? "").toLowerCase();
    if (!providerRef || !raw) return { received: true };

    const status = ["delivered", "success"].includes(raw)
      ? ("DELIVERED" as const)
      : ["failed", "undelivered", "expired", "rejected"].includes(raw)
        ? ("FAILED" as const)
        : null;
    if (!status) return { received: true };

    await this.prisma.withServiceBypass(async (tx) => {
      const updated = await tx.message.updateMany({
        where: { providerRef, channel: "SMS" },
        data:
          status === "DELIVERED"
            ? { status, deliveredAt: new Date() }
            : { status, failedAt: new Date() },
      });
      if (updated.count === 0) this.logger.warn(`SMS DLR for unknown providerRef ${providerRef}`);
    });
    return { received: true };
  }
}
