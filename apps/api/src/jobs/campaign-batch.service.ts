import { Injectable, Logger } from "@nestjs/common";
import { segmentSchema, CAMPAIGN_BATCH_SIZE } from "@pharmacrm/shared";
import { PrismaService } from "../common/prisma.service";
import { MessagingService } from "../modules/messaging/messaging.service";
import { buildSegmentWhere } from "../modules/campaigns/segment";

export type BatchOutcome =
  | { kind: "done" }
  | { kind: "more"; nextCursor: string }
  | { kind: "delayed"; delayMs: number; resumeCursor: string | null }
  | { kind: "cancelled" }
  | { kind: "cap_stopped" }
  | { kind: "not_found" };

/**
 * One campaign batch = up to 50 customers, walked cursor-style over the
 * segment (docs/05 §6). Runs under service-bypass — campaigns fire from jobs,
 * outside any request. Every message goes through MessagingService's campaign
 * gate (opt-out → quiet hours → cap → template). Cancellation is honored
 * between batches AND between messages: status is re-read each batch.
 */
@Injectable()
export class CampaignBatchService {
  private readonly logger = new Logger(CampaignBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  async runBatch(campaignId: string, cursor: string | null): Promise<BatchOutcome> {
    const campaign = await this.prisma.withServiceBypass((tx) =>
      tx.campaign.findUnique({ where: { id: campaignId } }),
    );
    if (!campaign) return { kind: "not_found" };
    if (campaign.status !== "SENDING") return { kind: "cancelled" };

    const segment = segmentSchema.parse(campaign.segment);
    const customers = await this.prisma.withServiceBypass((tx) =>
      tx.customer.findMany({
        // includeOptedOut: the per-message gate records SKIPPED_OPTOUT for them
        where: { pharmacyId: campaign.pharmacyId, ...buildSegmentWhere(segment, { includeOptedOut: true }) },
        orderBy: { id: "asc" },
        take: CAMPAIGN_BATCH_SIZE + 1,
        select: { id: true },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    const hasMore = customers.length > CAMPAIGN_BATCH_SIZE;
    const batch = hasMore ? customers.slice(0, CAMPAIGN_BATCH_SIZE) : customers;

    let lastProcessed: string | null = null;
    for (const c of batch) {
      const outcome = await this.messaging.sendCampaignMessage(campaignId, c.id);
      if (outcome.kind === "delayed") {
        // quiet hours — resume this batch from where we stopped
        return { kind: "delayed", delayMs: outcome.delayMs, resumeCursor: lastProcessed ?? cursor };
      }
      if (outcome.kind === "skipped_cap") {
        // monthly cap exhausted — close the campaign at what actually went out
        await this.finish(campaignId);
        this.logger.warn(`Campaign ${campaignId} stopped early: monthly cap reached`);
        return { kind: "cap_stopped" };
      }
      lastProcessed = c.id;
    }

    if (hasMore) return { kind: "more", nextCursor: batch[batch.length - 1]!.id };
    await this.finish(campaignId);
    return { kind: "done" };
  }

  /** SENT + sentAt + recipientCount = messages actually recorded (any status). */
  private async finish(campaignId: string): Promise<void> {
    await this.prisma.withServiceBypass(async (tx) => {
      const recipientCount = await tx.message.count({ where: { campaignId } });
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: "SENT", sentAt: new Date(), recipientCount },
      });
    });
  }
}
