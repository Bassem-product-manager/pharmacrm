import { Injectable, Logger } from "@nestjs/common";

/**
 * PostHog emission (docs/03 §4 modules/analytics). Fire-and-forget: product
 * analytics must never fail or slow a sale. No-op unless POSTHOG_KEY is set
 * (dev/tests run without it); real key setup is build/checklists/external-setup.md.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  capture(event: string, distinctId: string, properties: Record<string, unknown> = {}): void {
    const apiKey = process.env.POSTHOG_KEY;
    if (!apiKey) return;
    const host = process.env.POSTHOG_HOST || "https://app.posthog.com";
    void fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties,
        timestamp: new Date().toISOString(),
      }),
    }).catch((err: unknown) => {
      this.logger.warn(`posthog capture failed for ${event}: ${String(err)}`);
    });
  }
}
