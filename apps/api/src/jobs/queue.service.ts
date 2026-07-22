import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  QUEUE_CAMPAIGN,
  QUEUE_FALLBACK,
  QUEUE_NIGHTLY,
  QUEUE_PREFIX,
  QUEUE_REMINDERS,
  QUEUE_SEND,
  redisConnection as connection,
  type CampaignJobData,
  type FallbackJobData,
  type SendJobData,
} from "./queues";

/**
 * Producer side of the pipeline. Workers live in jobs.worker.ts.
 * Job ids are deterministic where dedup matters (reminder send = reminderId)
 * so Bull refuses accidental duplicates on top of the DB @@unique (R10).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  readonly reminders = new Queue(QUEUE_REMINDERS, { connection: connection(), prefix: QUEUE_PREFIX });
  readonly send = new Queue<SendJobData>(QUEUE_SEND, { connection: connection(), prefix: QUEUE_PREFIX });
  readonly fallback = new Queue<FallbackJobData>(QUEUE_FALLBACK, { connection: connection(), prefix: QUEUE_PREFIX });
  readonly nightly = new Queue(QUEUE_NIGHTLY, { connection: connection(), prefix: QUEUE_PREFIX });
  readonly campaign = new Queue<CampaignJobData>(QUEUE_CAMPAIGN, { connection: connection(), prefix: QUEUE_PREFIX });

  /** Register repeatable schedules (idempotent — same key upserts). */
  async registerSchedules(): Promise<void> {
    await this.reminders.upsertJobScheduler("reminder-scan", { every: 15 * 60 * 1000 });
    // 03:00 Africa/Cairo nightly (docs/04 Flow 4)
    await this.nightly.upsertJobScheduler("nightly", {
      pattern: "0 3 * * *",
      tz: "Africa/Cairo",
    });
    this.logger.log("Job schedulers registered (reminder-scan q15min, nightly 03:00 Cairo)");
  }

  async enqueueSend(data: SendJobData, opts: { delayMs?: number } = {}): Promise<void> {
    await this.send.add("send-reminder", data, {
      delay: opts.delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async enqueueFallbackCheck(data: FallbackJobData, delayMs: number): Promise<void> {
    await this.fallback.add(data.step, data, {
      delay: delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Next campaign batch. 1s between batches (docs/05 §6) — provider-friendly. */
  async enqueueCampaignBatch(data: CampaignJobData, delayMs = 0): Promise<void> {
    await this.campaign.add("campaign-batch", data, {
      delay: delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async onModuleDestroy() {
    await Promise.all([
      this.reminders.close(),
      this.send.close(),
      this.fallback.close(),
      this.nightly.close(),
      this.campaign.close(),
    ]);
  }
}
