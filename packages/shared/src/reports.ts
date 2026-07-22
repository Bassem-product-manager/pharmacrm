import { z } from "zod";

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** GET /reports/sales.csv?from=&to= — Cairo calendar days, inclusive. */
export const reportRangeSchema = z
  .object({
    from: dayString.optional(),
    to: dayString.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "from must be <= to");
export type ReportRangeQuery = z.infer<typeof reportRangeSchema>;

/** PATCH /admin/pharmacies/:id/plan */
export const adminPlanPatchSchema = z.object({
  plan: z.enum(["FREE", "PRO"]),
});
export type AdminPlanPatchInput = z.input<typeof adminPlanPatchSchema>;

export const adminPharmaciesQuerySchema = z.object({
  sort: z.enum(["lastActive", "created", "name"]).default("lastActive"),
});
export type AdminPharmaciesQuery = z.infer<typeof adminPharmaciesQuerySchema>;

/** GET /admin/pharmacies/:id/analytics?period= — rolling windows (+quarter, +custom from/to). */
export const ANALYTICS_PERIODS = ["day", "week", "month", "quarter", "year", "custom"] as const;
export const adminAnalyticsQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS).default("month"),
    from: dayString.optional(),
    to: dayString.optional(),
  })
  .refine((v) => v.period !== "custom" || (v.from && v.to && v.from <= v.to), {
    message: "custom period requires from<=to",
  });
export type AdminAnalyticsQuery = z.infer<typeof adminAnalyticsQuerySchema>;
export const PERIOD_DAYS: Record<Exclude<(typeof ANALYTICS_PERIODS)[number], "custom">, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

/**
 * Metric definition layer (docs/metrics.md is the human contract; MetricsService
 * is the single implementation). Every widget/export queries THESE names.
 */
export const PLATFORM_METRICS = [
  "revenue", // Σ(Sale.totalEgp − discountEgp), net, Africa/Cairo day buckets
  "sales", // COUNT(Sale)
  "customers", // COUNT(Customer created in window, deletedAt IS NULL)
  "pharmacies", // COUNT(Pharmacy created in window)
  "messages", // COUNT(Message created in window)
] as const;
export type PlatformMetric = (typeof PLATFORM_METRICS)[number];

export const adminRangeSchema = z
  .object({
    from: dayString,
    to: dayString,
  })
  .refine((v) => v.from <= v.to, "from must be <= to");

export const adminKpisQuerySchema = adminRangeSchema;
export type AdminKpisQuery = z.infer<typeof adminKpisQuerySchema>;

export const adminSeriesQuerySchema = z.object({
  metric: z.enum(PLATFORM_METRICS),
  from: dayString,
  to: dayString,
});
export type AdminSeriesQuery = z.infer<typeof adminSeriesQuerySchema>;

export const DISTRIBUTION_DIMENSIONS = ["pharmacy", "plan", "category"] as const;
export const adminDistributionQuerySchema = z.object({
  metric: z.enum(["revenue", "sales", "customers", "subscribers", "messages"]),
  by: z.enum(DISTRIBUTION_DIMENSIONS).default("pharmacy"),
  from: dayString,
  to: dayString,
});
export type AdminDistributionQuery = z.infer<typeof adminDistributionQuerySchema>;

/** POST /admin/pharmacies/:id/block — reason is mandatory (audited). */
export const adminBlockSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  note: z.string().trim().max(1000).optional(),
});
export type AdminBlockInput = z.input<typeof adminBlockSchema>;
