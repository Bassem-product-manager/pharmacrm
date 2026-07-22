import { z } from "zod";

export const createRefillRuleSchema = z.object({
  productRefId: z.string().min(1), // R9 — exact ProductRef match, never fuzzy text
  cycleDays: z.number().int().min(1).max(365),
  remindDaysBefore: z.number().int().min(0).max(30).default(2),
  autoSend: z.boolean().default(true),
});
export type CreateRefillRuleInput = z.input<typeof createRefillRuleSchema>;

export const updateRefillRuleSchema = z.object({
  cycleDays: z.number().int().min(1).max(365).optional(),
  remindDaysBefore: z.number().int().min(0).max(30).optional(),
  autoSend: z.boolean().optional(),
  isActive: z.boolean().optional(),
  /** true → soft delete (deletedAt=now) */
  deleted: z.boolean().optional(),
});
export type UpdateRefillRuleInput = z.input<typeof updateRefillRuleSchema>;

export const REFILL_BUCKETS = ["overdue", "today", "week"] as const;
export const refillsQueueQuerySchema = z.object({
  bucket: z.enum(REFILL_BUCKETS).default("today"),
});
export type RefillsQueueQuery = z.infer<typeof refillsQueueQuerySchema>;

export const snoozeSchema = z.object({
  days: z.number().int().min(1).max(30),
});
export type SnoozeInput = z.input<typeof snoozeSchema>;

/** Opt-out keywords parsed from inbound WA messages (docs/04 Flow 2, R3). */
export const OPT_OUT_KEYWORDS = ["إلغاء", "الغاء", "ايقاف", "إيقاف", "stop"] as const;

export const isOptOutText = (text: string): boolean => {
  const t = text.trim().toLowerCase();
  return OPT_OUT_KEYWORDS.some((k) => t === k || t.startsWith(`${k} `) || t.endsWith(` ${k}`));
};

/** WA template used for refill reminders (pre-approved in Meta — R4). */
export const REFILL_TEMPLATE_NAME = "refill_reminder";
