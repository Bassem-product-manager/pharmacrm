import { z } from "zod";

/** GET /dashboard/summary?days= — trend window length (default 14). */
export const dashboardQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(14),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** One point on the sales trend line (a calendar day in Africa/Cairo). */
export interface TrendPoint {
  date: string; // YYYY-MM-DD (Cairo)
  salesCount: number;
  salesEgp: number;
}

export interface DashboardSummary {
  todaySalesCount: number;
  todaySalesEgp: number;
  activeCustomers: number; // visited within 30d
  inactiveCustomers: number; // lastVisitAt older than 30d
  lowStockCount: number;
  pointsRedeemedThisMonth: number;
  trend: TrendPoint[];
  topProducts: { productRefId: string; nameText: string; qty: number; revenueEgp: number }[];
  lowStockItems: { id: string; nameText: string; stock: number; category: string | null }[];
  /** top spenders in the trend window (net of discount) */
  topCustomers: { customerId: string; name: string; salesCount: number; spendEgp: number }[];
  /** Σ over active refill rules of product price × expected dues in the next 30d */
  upcomingRefillRevenueEgp30d: number;
  /** payment-cycle prediction: customers whose average purchase interval says they're due within 7d */
  expectedVisits7d: {
    count: number;
    customers: { customerId: string; name: string; expectedAt: string; avgIntervalDays: number }[];
  };
}
