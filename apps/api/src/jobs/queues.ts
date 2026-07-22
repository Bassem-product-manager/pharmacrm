/** Queue names + payload types shared by producers and workers. */
/**
 * Redis key prefix — tests get their own namespace so a live dev server's
 * workers NEVER consume jobs enqueued by an e2e run against the same Redis
 * (that exact collision double-sent campaign messages once). Producers and
 * workers must agree on this.
 */
export const QUEUE_PREFIX = process.env.NODE_ENV === "test" ? "bull-test" : "bull";

/**
 * Single source of truth for the BullMQ Redis connection (producers +
 * workers). Handles hosted Redis (Upstash/Render): `rediss://` enables TLS,
 * and `maxRetriesPerRequest: null` is MANDATORY for BullMQ workers (ioredis
 * default of 20 makes blocking commands throw). Falls back to local dev.
 */
export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export const QUEUE_REMINDERS = "reminders"; // repeatable q15min scan
export const QUEUE_SEND = "send"; // one job per reminder send attempt
export const QUEUE_FALLBACK = "fallback"; // +6h WA check / +2h SMS final check
export const QUEUE_NIGHTLY = "nightly"; // 03:00 Cairo maintenance
export const QUEUE_CAMPAIGN = "campaign"; // session 7 — batched campaign sends

export interface SendJobData {
  reminderId: string;
  bypassQuietHours?: boolean;
}

export interface FallbackJobData {
  step: "wa-check" | "sms-final";
  messageId: string;
}

export interface CampaignJobData {
  campaignId: string;
  /** last processed customer id — batches walk the segment cursor-style */
  cursor: string | null;
}
