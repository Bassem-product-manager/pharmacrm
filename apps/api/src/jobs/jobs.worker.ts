import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { CAMPAIGN_BATCH_DELAY_MS } from "@pharmacrm/shared";
import { MessagingService } from "../modules/messaging/messaging.service";
import { CampaignBatchService } from "./campaign-batch.service";
import { NightlyService } from "./nightly.service";
import { QueueService } from "./queue.service";
import { ReminderScanService } from "./reminder-scan.service";
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
 * Worker side. Disabled under tests (JOBS_DISABLED=1) — tests drive the same
 * handler methods directly so no timing flakiness.
 * Outcome → queue wiring:
 *   send: "delayed"    → re-enqueue send with delay (quiet hours)
 *         "sent"/"failed_now" → fallback wa-check (+6h / +1min)
 *   fallback wa-check: "sms_sent" → fallback sms-final (+2h)
 *                      "delayed"  → re-enqueue wa-check with delay
 */
@Injectable()
export class JobsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsWorker.name);
  private workers: Worker[] = [];

  constructor(
    private readonly queues: QueueService,
    private readonly messaging: MessagingService,
    private readonly scanner: ReminderScanService,
    private readonly nightly: NightlyService,
    private readonly campaignBatch: CampaignBatchService,
  ) {}

  async onModuleInit() {
    if (process.env.JOBS_DISABLED === "1" || process.env.NODE_ENV === "test") {
      this.logger.log("Jobs workers disabled (JOBS_DISABLED/test)");
      return;
    }
    await this.queues.registerSchedules();

    this.workers = [
      new Worker(QUEUE_REMINDERS, async () => void (await this.scanner.scan()), {
        connection: connection(),
        prefix: QUEUE_PREFIX,
      }),
      new Worker<SendJobData>(QUEUE_SEND, (job) => this.handleSend(job), {
        connection: connection(),
        prefix: QUEUE_PREFIX,
        concurrency: 5,
      }),
      new Worker<FallbackJobData>(QUEUE_FALLBACK, (job) => this.handleFallback(job), {
        connection: connection(),
        prefix: QUEUE_PREFIX,
        concurrency: 5,
      }),
      new Worker(QUEUE_NIGHTLY, async () => void (await this.nightly.run()), {
        connection: connection(),
        prefix: QUEUE_PREFIX,
      }),
      new Worker<CampaignJobData>(QUEUE_CAMPAIGN, (job) => this.handleCampaignBatch(job), {
        connection: connection(),
        prefix: QUEUE_PREFIX,
        concurrency: 1, // batches are sequential by design (1s spacing)
      }),
    ];
    for (const w of this.workers) {
      w.on("failed", (job, err) =>
        this.logger.error(`Job ${job?.queueName}/${job?.name} failed: ${err.message}`),
      );
    }
    this.logger.log("Jobs workers started");
  }

  async handleSend(job: Job<SendJobData>) {
    const outcome = await this.messaging.sendReminder(job.data.reminderId, {
      bypassQuietHours: job.data.bypassQuietHours,
    });
    switch (outcome.kind) {
      case "delayed":
        await this.queues.enqueueSend(job.data, { delayMs: outcome.delayMs });
        break;
      case "sent":
      case "failed_now":
        await this.queues.enqueueFallbackCheck(
          { step: "wa-check", messageId: outcome.messageId },
          outcome.fallbackCheckDelayMs,
        );
        break;
      default: // skipped_optout / skipped_cap / not_found — terminal
    }
    return outcome.kind;
  }

  async handleCampaignBatch(job: Job<CampaignJobData>) {
    const outcome = await this.campaignBatch.runBatch(job.data.campaignId, job.data.cursor);
    switch (outcome.kind) {
      case "more":
        await this.queues.enqueueCampaignBatch(
          { campaignId: job.data.campaignId, cursor: outcome.nextCursor },
          CAMPAIGN_BATCH_DELAY_MS,
        );
        break;
      case "delayed": // quiet hours — resume the same batch when the window opens
        await this.queues.enqueueCampaignBatch(
          { campaignId: job.data.campaignId, cursor: outcome.resumeCursor },
          outcome.delayMs,
        );
        break;
      default: // done / cancelled / cap_stopped / not_found — terminal
    }
    return outcome.kind;
  }

  async handleFallback(job: Job<FallbackJobData>) {
    if (job.data.step === "wa-check") {
      const outcome = await this.messaging.runFallbackCheck(job.data.messageId);
      switch (outcome.kind) {
        case "delayed":
          await this.queues.enqueueFallbackCheck(job.data, outcome.delayMs);
          break;
        case "sms_sent":
          await this.queues.enqueueFallbackCheck(
            { step: "sms-final", messageId: outcome.messageId },
            outcome.finalCheckDelayMs,
          );
          break;
        default: // terminal
      }
      return outcome.kind;
    }
    return this.messaging.runFinalCheck(job.data.messageId);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
