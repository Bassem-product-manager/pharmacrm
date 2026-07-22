import { Injectable, Logger } from "@nestjs/common";
import type { MessagingProvider, SendMessageInput } from "./messaging-provider.interface";

/**
 * Meta WhatsApp Cloud API provider (T3 — direct, no BSP).
 * STUB in Session 6: real HTTP wiring is external-setup.md work. The contract
 * (templateName REQUIRED — R4) is enforced here already so swapping in the
 * real call changes nothing upstream.
 */
@Injectable()
export class WhatsAppProvider implements MessagingProvider {
  private readonly logger = new Logger(WhatsAppProvider.name);

  async send(msg: SendMessageInput): Promise<{ providerRef: string }> {
    if (!msg.templateName) {
      // R4 hard rule — a WA send without an approved template is a BUG.
      throw new Error("WA_TEMPLATE_REQUIRED: WhatsApp sends require templateName");
    }
    const token = process.env.WA_TOKEN;
    const phoneId = process.env.WA_PHONE_ID;
    if (!token || !phoneId) {
      throw new Error("WA_NOT_CONFIGURED: set WA_TOKEN and WA_PHONE_ID (see external-setup.md)");
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: "ar" },
          components: msg.templateParams
            ? [
                {
                  type: "body",
                  parameters: Object.values(msg.templateParams).map((text) => ({
                    type: "text",
                    text,
                  })),
                },
              ]
            : [],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`WA send failed ${res.status}: ${body}`);
      throw new Error(`WA_SEND_FAILED_${res.status}`);
    }
    const data = (await res.json()) as { messages?: { id: string }[] };
    const providerRef = data.messages?.[0]?.id;
    if (!providerRef) throw new Error("WA_SEND_NO_MESSAGE_ID");
    return { providerRef };
  }
}
