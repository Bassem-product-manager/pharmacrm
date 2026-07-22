import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { MessagingProvider, SendMessageInput } from "./messaging-provider.interface";

/**
 * Dev/test provider — logs instead of sending, records calls so tests can
 * assert "no provider call happened" (gate tests) or inspect payloads.
 */
@Injectable()
export class MockProvider implements MessagingProvider {
  private readonly logger = new Logger(MockProvider.name);
  readonly calls: (SendMessageInput & { providerRef: string })[] = [];

  async send(msg: SendMessageInput): Promise<{ providerRef: string }> {
    const providerRef = `mock-${randomUUID()}`;
    this.calls.push({ ...msg, providerRef });
    this.logger.log(
      `MOCK send → ${msg.to} ${msg.templateName ? `[template:${msg.templateName}]` : "[sms]"} ${msg.bodyText ?? ""} (${providerRef})`,
    );
    return { providerRef };
  }

  reset() {
    this.calls.length = 0;
  }
}
