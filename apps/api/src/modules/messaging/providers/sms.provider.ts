import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { MessagingProvider, SendMessageInput } from "./messaging-provider.interface";

/**
 * Egyptian SMS gateway behind the swappable interface (docs/03 — vendor TBD
 * at external-setup time). STUB: logs and returns a fake DLR ref until the
 * gateway account exists. bodyText only — templates are a WA concept.
 */
@Injectable()
export class SmsProvider implements MessagingProvider {
  private readonly logger = new Logger(SmsProvider.name);

  async send(msg: SendMessageInput): Promise<{ providerRef: string }> {
    if (!msg.bodyText) throw new Error("SMS_BODY_REQUIRED");
    if (!process.env.SMS_API_KEY) {
      throw new Error("SMS_NOT_CONFIGURED: set SMS_API_KEY (see external-setup.md)");
    }
    // TODO(external-setup): real gateway HTTP call goes here.
    const providerRef = `sms-${randomUUID()}`;
    this.logger.log(`SMS (stub) send → ${msg.to}: ${msg.bodyText} (${providerRef})`);
    return { providerRef };
  }
}
