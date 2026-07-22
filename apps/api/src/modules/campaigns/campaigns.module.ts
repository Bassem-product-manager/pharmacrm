import { Module } from "@nestjs/common";
import { JobsModule } from "../../jobs/jobs.module";
import { CampaignsController, TemplatesController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [JobsModule],
  controllers: [CampaignsController, TemplatesController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
