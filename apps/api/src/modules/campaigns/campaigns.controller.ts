import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  APPROVED_CAMPAIGN_TEMPLATES,
  createCampaignSchema,
  previewSegmentSchema,
  type CreateCampaignInput,
  type PreviewSegmentInput,
} from "@pharmacrm/shared";
import { Roles } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { CampaignsService } from "./campaigns.service";

/**
 * docs/05 §6 — campaigns are OWNER-only end to end (class-level guard):
 * STAFF must 403 on every route here. Plan gate (FREE → 403
 * PLAN_UPGRADE_REQUIRED) lives in the service, on create.
 */
@Roles("OWNER")
@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list() {
    return this.campaigns.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignInput,
  ) {
    return this.campaigns.create(body);
  }

  @Post("preview-segment")
  @HttpCode(200)
  preview(
    @Body(new ZodValidationPipe(previewSegmentSchema)) body: PreviewSegmentInput,
  ) {
    return this.campaigns.previewSegment(body.segment);
  }

  @Post(":id/send")
  @HttpCode(200)
  send(@Param("id") id: string) {
    return this.campaigns.send(id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@Param("id") id: string) {
    return this.campaigns.cancel(id);
  }

  @Get(":id/report")
  report(@Param("id") id: string) {
    return this.campaigns.report(id);
  }
}

/** Approved WA template catalog — readable by both roles (wizard step 2). */
@Controller("templates")
export class TemplatesController {
  @Get()
  list() {
    return APPROVED_CAMPAIGN_TEMPLATES;
  }
}
