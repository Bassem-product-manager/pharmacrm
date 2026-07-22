import { Injectable } from "@nestjs/common";
import {
  LOW_STOCK_THRESHOLD,
  type DashboardQuery,
  type DashboardSummary,
  type TrendPoint,
} from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { cairoDayKey, cairoDayRange, cairoTodayKey } from "../sales/sales.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Session 7 — dashboard analytics (S10). One tenant-scoped call powers the
 * stat cards, the sales trend line, top products, and the low-stock list.
 * Day bucketing is Africa/Cairo via Intl (DST-safe), matching GET /sales.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: DashboardQuery): Promise<DashboardSummary> {
    const days = query.days;
    const todayKey = cairoTodayKey();
    const today = cairoDayRange(todayKey);
    const windowStart = cairoDayRange(
      cairoDayKey(new Date(today.start.getTime() - (days - 1) * DAY_MS)),
    ).start;
    const monthStart = new Date(`${todayKey.slice(0, 7)}-01T00:00:00Z`);
    const inactiveCutoff = new Date(Date.now() - 30 * DAY_MS);

    const [
      salesInWindow,
      todayAgg,
      activeCustomers,
      inactiveCustomers,
      lowStockItems,
      lowStockCount,
      redeemedAgg,
    ] = await Promise.all([
      this.prisma.tenant.sale.findMany({
        where: { createdAt: { gte: windowStart } },
        select: {
          createdAt: true,
          totalEgp: true,
          discountEgp: true,
          customerId: true,
          customer: { select: { name: true } },
          items: { select: { productRefId: true, nameText: true, qty: true, unitPriceEgp: true } },
        },
      }),
      this.prisma.tenant.sale.aggregate({
        where: { createdAt: { gte: today.start, lt: today.end } },
        _count: { _all: true },
        _sum: { totalEgp: true },
      }),
      this.prisma.tenant.customer.count({
        where: { deletedAt: null, lastVisitAt: { gte: inactiveCutoff } },
      }),
      this.prisma.tenant.customer.count({
        where: { deletedAt: null, lastVisitAt: { lt: inactiveCutoff } },
      }),
      this.prisma.tenant.productRef.findMany({
        where: { deletedAt: null, stock: { lte: LOW_STOCK_THRESHOLD } },
        select: { id: true, nameText: true, stock: true, category: true },
        orderBy: { stock: "asc" },
        take: 20,
      }),
      this.prisma.tenant.productRef.count({
        where: { deletedAt: null, stock: { lte: LOW_STOCK_THRESHOLD } },
      }),
      this.prisma.tenant.pointsTransaction.aggregate({
        where: { type: "REDEEM", createdAt: { gte: monthStart } },
        _sum: { points: true },
      }),
    ]);

    // ---- trend: pre-seed every day in the window at zero, then fill ----
    const buckets = new Map<string, { salesCount: number; salesEgp: number }>();
    for (let i = 0; i < days; i++) {
      const key = cairoDayKey(new Date(today.start.getTime() - i * DAY_MS));
      buckets.set(key, { salesCount: 0, salesEgp: 0 });
    }
    const topByProduct = new Map<string, { nameText: string; qty: number; revenueEgp: number }>();
    const topByCustomer = new Map<string, { name: string; salesCount: number; spendEgp: number }>();
    for (const sale of salesInWindow) {
      const key = cairoDayKey(sale.createdAt);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.salesCount += 1;
        bucket.salesEgp += Number(sale.totalEgp) - Number(sale.discountEgp);
      }
      const cust = topByCustomer.get(sale.customerId) ?? {
        name: sale.customer.name,
        salesCount: 0,
        spendEgp: 0,
      };
      cust.salesCount += 1;
      cust.spendEgp += Number(sale.totalEgp) - Number(sale.discountEgp);
      topByCustomer.set(sale.customerId, cust);
      for (const item of sale.items) {
        if (!item.productRefId) continue;
        const cur = topByProduct.get(item.productRefId) ?? {
          nameText: item.nameText,
          qty: 0,
          revenueEgp: 0,
        };
        cur.qty += item.qty;
        cur.revenueEgp += Number(item.unitPriceEgp) * item.qty;
        topByProduct.set(item.productRefId, cur);
      }
    }
    const trend: TrendPoint[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, salesCount: v.salesCount, salesEgp: round2(v.salesEgp) }));

    const topProducts = [...topByProduct.entries()]
      .map(([productRefId, v]) => ({ productRefId, ...v, revenueEgp: round2(v.revenueEgp) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const topCustomers = [...topByCustomer.entries()]
      .map(([customerId, v]) => ({ customerId, ...v, spendEgp: round2(v.spendEgp) }))
      .sort((a, b) => b.spendEgp - a.spendEgp)
      .slice(0, 5);

    const [upcomingRefillRevenueEgp30d, expectedVisits7d] = await Promise.all([
      this.upcomingRefillRevenue(),
      this.expectedVisits(),
    ]);

    return {
      todaySalesCount: todayAgg._count._all,
      todaySalesEgp: round2(Number(todayAgg._sum.totalEgp ?? 0)),
      activeCustomers,
      inactiveCustomers,
      lowStockCount,
      pointsRedeemedThisMonth: Math.abs(redeemedAgg._sum.points ?? 0),
      trend,
      topProducts,
      lowStockItems,
      topCustomers,
      upcomingRefillRevenueEgp30d,
      expectedVisits7d,
    };
  }

  /**
   * Payment-cycle forecast leg 1 — refill rules are contracted demand:
   * Σ over active rules of product price × dues falling in the next 30 days.
   */
  private async upcomingRefillRevenue(): Promise<number> {
    const rules = await this.prisma.tenant.refillRule.findMany({
      where: { deletedAt: null, isActive: true },
      select: { cycleDays: true, nextDueAt: true, productRef: { select: { priceEgp: true } } },
    });
    const horizon = Date.now() + 30 * DAY_MS;
    let total = 0;
    for (const r of rules) {
      const price = Number(r.productRef.priceEgp ?? 0);
      if (price <= 0) continue;
      // count dues in (now, now+30d]: first due (even if overdue counts once), then every cycle
      let due = r.nextDueAt.getTime();
      if (due < Date.now()) due = Date.now(); // overdue → expect it now
      let occurrences = 0;
      while (due <= horizon) {
        occurrences += 1;
        due += r.cycleDays * DAY_MS;
      }
      total += price * occurrences;
    }
    return round2(total);
  }

  /**
   * Payment-cycle forecast leg 2 — behavioral: customers with ≥2 purchases
   * get an average interval; expectedAt = lastVisit + avg. Due window is
   * [now−2d, now+7d] so slightly-late regulars still show as "due".
   */
  private async expectedVisits() {
    const agg = await this.prisma.tenant.sale.groupBy({
      by: ["customerId"],
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    const candidates = agg
      .filter((a) => a._count._all >= 2 && a._min.createdAt && a._max.createdAt)
      .map((a) => {
        const spanMs = a._max.createdAt!.getTime() - a._min.createdAt!.getTime();
        const avgMs = spanMs / (a._count._all - 1);
        return {
          customerId: a.customerId,
          avgIntervalDays: Math.round((avgMs / DAY_MS) * 10) / 10,
          expectedAt: new Date(a._max.createdAt!.getTime() + avgMs),
        };
      })
      .filter(
        (c) =>
          c.avgIntervalDays >= 1 &&
          c.expectedAt.getTime() >= Date.now() - 2 * DAY_MS &&
          c.expectedAt.getTime() <= Date.now() + 7 * DAY_MS,
      )
      .sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime());

    const names = await this.prisma.tenant.customer.findMany({
      where: { id: { in: candidates.map((c) => c.customerId) }, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    const customers = candidates
      .filter((c) => nameById.has(c.customerId))
      .slice(0, 8)
      .map((c) => ({
        customerId: c.customerId,
        name: nameById.get(c.customerId)!,
        expectedAt: c.expectedAt.toISOString(),
        avgIntervalDays: c.avgIntervalDays,
      }));
    return { count: customers.length, customers };
  }
}
