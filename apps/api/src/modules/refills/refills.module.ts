import { Module } from "@nestjs/common";
import { JobsModule } from "../../jobs/jobs.module";
import { MessagingModule } from "../messaging/messaging.module";
import { RefillsController } from "./refills.controller";
import { RefillsService } from "./refills.service";

@Module({
  imports: [MessagingModule, JobsModule],
  controllers: [RefillsController],
  providers: [RefillsService],
  exports: [RefillsService],
})
export class RefillsModule {}
