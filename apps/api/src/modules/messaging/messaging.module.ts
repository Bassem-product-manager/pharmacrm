import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { MockProvider } from "./providers/mock.provider";
import { SmsProvider } from "./providers/sms.provider";
import { WhatsAppProvider } from "./providers/whatsapp.provider";
import { SMS_PROVIDER, WA_PROVIDER } from "./providers/messaging-provider.interface";
import { SmsWebhookController } from "./webhooks/sms.webhook.controller";
import { WhatsAppWebhookController } from "./webhooks/whatsapp.webhook.controller";

/**
 * Provider selection: MockProvider whenever real credentials are absent or
 * NODE_ENV=test — so dev/e2e NEVER hit Meta or the SMS gateway (session plan:
 * "Mock provider only; real WA is external-setup.md").
 */
const useMockWa = () => process.env.NODE_ENV === "test" || !process.env.WA_TOKEN;
const useMockSms = () => process.env.NODE_ENV === "test" || !process.env.SMS_API_KEY;

@Module({
  controllers: [WhatsAppWebhookController, SmsWebhookController],
  providers: [
    MockProvider,
    WhatsAppProvider,
    SmsProvider,
    {
      provide: WA_PROVIDER,
      inject: [MockProvider, WhatsAppProvider],
      useFactory: (mock: MockProvider, real: WhatsAppProvider) => (useMockWa() ? mock : real),
    },
    {
      provide: SMS_PROVIDER,
      inject: [MockProvider, SmsProvider],
      useFactory: (mock: MockProvider, real: SmsProvider) => (useMockSms() ? mock : real),
    },
    MessagingService,
  ],
  exports: [MessagingService, MockProvider, WA_PROVIDER, SMS_PROVIDER],
})
export class MessagingModule {}
