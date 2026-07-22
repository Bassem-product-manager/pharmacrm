/** docs/05 §4 — provider contract. WA requires templateName; SMS bodyText only. */
export interface SendMessageInput {
  to: string; // E.164
  templateName?: string;
  templateParams?: Record<string, string>;
  bodyText?: string;
}

export interface MessagingProvider {
  send(msg: SendMessageInput): Promise<{ providerRef: string }>;
}

export const WA_PROVIDER = "WA_PROVIDER";
export const SMS_PROVIDER = "SMS_PROVIDER";
