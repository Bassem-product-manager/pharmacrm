import { z } from "zod";
import { tagSchema } from "./customers";

/**
 * Campaigns (docs/05 §6, session 7). Segment is a small declarative JSON —
 * the API resolves it to customers, ALWAYS excluding opted-out + deleted.
 */
export const segmentSchema = z.object({
  /** match ANY of these tags (omit = all customers) */
  tags: z.array(tagSchema).optional(),
  /** lastVisitAt older than N days */
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
  /** pointsBalance >= N (loyalty campaigns) */
  minPoints: z.coerce.number().int().min(0).optional(),
});
export type SegmentInput = z.input<typeof segmentSchema>;

/**
 * Approved WA template catalog (R4 — no free-text WA sends, ever).
 * Mock of Meta's approved-template list; production syncs from the WA Cloud
 * API. `params` are the placeholder names the wizard collects.
 */
export const APPROVED_CAMPAIGN_TEMPLATES = [
  {
    name: "offer_generic",
    titleAr: "عرض عام",
    bodyAr: "{{name}}، عرض خاص في {{pharmacy}}: {{offer}}. في انتظارك!",
    params: ["offer"],
  },
  {
    name: "winback_inactive",
    titleAr: "استرجاع عميل غائب",
    bodyAr: "{{name}}، وحشتنا في {{pharmacy}}! زورنا وهتلاقي عرض مخصوص ليك.",
    params: [],
  },
  {
    name: "points_balance",
    titleAr: "تذكير برصيد النقاط",
    bodyAr: "{{name}}، رصيدك {{points}} نقطة في {{pharmacy}} — استبدلها بخصم في زيارتك الجاية.",
    params: [],
  },
] as const;
export const APPROVED_TEMPLATE_NAMES = APPROVED_CAMPAIGN_TEMPLATES.map((t) => t.name);

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  segment: segmentSchema,
  templateName: z.string().min(1),
  templateParams: z.record(z.string(), z.string().max(200)).optional(),
  /** rendered SMS copy (fallback estimate; ≤2 Arabic segments) */
  templateSms: z.string().trim().min(2).max(160),
});
export type CreateCampaignInput = z.input<typeof createCampaignSchema>;

export const previewSegmentSchema = z.object({ segment: segmentSchema });
export type PreviewSegmentInput = z.input<typeof previewSegmentSchema>;

/** Per-message provider cost (EGP) — mock rates; real rates land in Phase E. */
export const WA_COST_EGP = 0.3;
export const SMS_COST_EGP = 0.55;
/** ~10% of WA sends historically fall back to SMS — priced into estimates. */
export const SMS_FALLBACK_RATIO = 0.1;

export const estimateCampaignCostEgp = (recipients: number): number =>
  Math.round(recipients * (WA_COST_EGP + SMS_FALLBACK_RATIO * SMS_COST_EGP) * 100) / 100;

/** Campaign batch size + spacing (docs/05 §6) — gentle on provider rate limits. */
export const CAMPAIGN_BATCH_SIZE = 50;
export const CAMPAIGN_BATCH_DELAY_MS = 1000;
