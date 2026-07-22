import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  APPROVED_TEMPLATE_NAMES,
  ERROR_CODES,
  estimateCampaignCostEgp,
  type CreateCampaignInput,
  type SegmentInput,
} from "@pharmacrm/shared";
import { getPharmacyId } from "../../common/tenant-context";
import { PrismaService } from "../../common/prisma.service";
import { QueueService } from "../../jobs/queue.service";
import { buildSegmentWhere } from "./segment";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Campaigns (docs/05 §6, session 7). OWNER-only (controller guard).
 * Plan gate: FREE pharmacies get 403 PLAN_UPGRADE_REQUIRED on create — this
 * is the monetization boundary, checked server-side on EVERY create.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  /** Segment → recipients (excl. opted-out/deleted) + estimated cost. */
  async previewSegment(segment: SegmentInput) {
    const recipients = await this.prisma.tenant.customer.count({
      where: buildSegmentWhere(segment),
    });
    return { recipients, estCostEgp: estimateCampaignCostEgp(recipients) };
  }

  async create(input: CreateCampaignInput) {
    if (!APPROVED_TEMPLATE_NAMES.includes(input.templateName as never)) {
      throw new BadRequestException({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: "templateName is not an approved WA template" },
      });
    }
    return this.prisma.withTenantRls(async (tx) => {
      const pharmacy = await tx.pharmacy.findUniqueOrThrow({
        where: { id: getPharmacyId()! },
        select: { plan: true },
      });
      if (pharmacy.plan === "FREE") {
        throw new ForbiddenException({
          error: {
            code: ERROR_CODES.PLAN_UPGRADE_REQUIRED,
            message: "Campaigns require the PRO plan",
          },
        });
      }
      // explicit pharmacyId — raw tx bypasses the Prisma tenant extension, and
      // RLS is a backstop we don't rely on for correctness (see decisions R6)
      const recipientCount = await tx.customer.count({
        where: { pharmacyId: getPharmacyId()!, ...buildSegmentWhere(input.segment) },
      });
      return tx.campaign.create({
        data: {
          pharmacyId: getPharmacyId()!,
          name: input.name,
          segment: input.segment,
          templateName: input.templateName,
          templateParams: input.templateParams,
          templateSms: input.templateSms,
          status: "DRAFT",
          recipientCount,
        },
      });
    });
  }

  async list() {
    return this.prisma.tenant.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
  }

  /** DRAFT → SENDING + first batch job. Worker walks the segment from there. */
  async send(id: string) {
    const campaign = await this.prisma.tenant.campaign.findFirst({ where: { id } });
    if (!campaign) this.notFound();
    if (!["DRAFT", "SCHEDULED"].includes(campaign!.status)) {
      throw new ConflictException({
        error: { code: ERROR_CODES.CAMPAIGN_INVALID_STATE, message: `Cannot send a ${campaign!.status} campaign` },
      });
    }
    const updated = await this.prisma.tenant.campaign.update({
      where: { id },
      data: { status: "SENDING" },
    });
    await this.queues.enqueueCampaignBatch({ campaignId: id, cursor: null });
    return updated;
  }

  /** Honored between batches — the worker re-reads status per batch. */
  async cancel(id: string) {
    const campaign = await this.prisma.tenant.campaign.findFirst({ where: { id } });
    if (!campaign) this.notFound();
    if (!["DRAFT", "SCHEDULED", "SENDING"].includes(campaign!.status)) {
      throw new ConflictException({
        error: { code: ERROR_CODES.CAMPAIGN_INVALID_STATE, message: `Cannot cancel a ${campaign!.status} campaign` },
      });
    }
    return this.prisma.tenant.campaign.update({ where: { id }, data: { status: "CANCELLED" } });
  }

  /**
   * Report: message statuses + spend + conversion (customers who received a
   * campaign message AND made a purchase within 7 days of the send).
   */
  async report(id: string) {
    const campaign = await this.prisma.tenant.campaign.findFirst({ where: { id } });
    if (!campaign) this.notFound();

    return this.prisma.withTenantRls(async (tx) => {
      const byStatus = await tx.message.groupBy({
        by: ["status"],
        where: { campaignId: id },
        _count: { _all: true },
      });
      const statuses = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
      const sentAt = campaign!.sentAt ?? campaign!.createdAt;
      const windowEnd = new Date(sentAt.getTime() + 7 * DAY_MS);

      const converted = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT s."customerId") AS count
        FROM "Sale" s
        WHERE s."customerId" IN (
          SELECT m."customerId" FROM "Message" m
          WHERE m."campaignId" = ${id} AND m.status NOT IN ('SKIPPED_OPTOUT','FAILED')
        )
        AND s."createdAt" >= ${sentAt} AND s."createdAt" < ${windowEnd}`;

      const costAgg = await tx.message.aggregate({
        where: { campaignId: id },
        _sum: { costMicro: true },
      });

      const total = byStatus.reduce((s, r) => s + r._count._all, 0);
      const delivered = (statuses["DELIVERED"] ?? 0) + (statuses["READ"] ?? 0);
      return {
        campaign: campaign!,
        totals: {
          messages: total,
          sent: statuses["SENT"] ?? 0,
          delivered,
          failed: statuses["FAILED"] ?? 0,
          skippedOptOut: statuses["SKIPPED_OPTOUT"] ?? 0,
          convertedCustomers: Number(converted[0]?.count ?? 0),
          costEgp: Number(costAgg._sum.costMicro ?? 0) / 1_000_000,
        },
        byStatus: statuses,
      };
    });
  }

  private notFound(): never {
    throw new NotFoundException({
      error: { code: ERROR_CODES.NOT_FOUND, message: "Campaign not found" },
    });
  }
}
