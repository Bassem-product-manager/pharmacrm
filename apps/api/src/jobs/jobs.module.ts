import { Module } from "@nestjs/common";
import { MessagingModule } from "../modules/messaging/messaging.module";
import { CampaignBatchService } from "./campaign-batch.service";
import { JobsWorker } from "./jobs.worker";
import { NightlyService } from "./nightly.service";
import { QueueService } from "./queue.service";
import { ReminderScanService } from "./reminder-scan.service";

@Module({
  imports: [MessagingModule],
  providers: [QueueService, ReminderScanService, NightlyService, CampaignBatchService, JobsWorker],
  exports: [QueueService, ReminderScanService, NightlyService, CampaignBatchService, JobsWorker],
})
export class JobsModule {}
