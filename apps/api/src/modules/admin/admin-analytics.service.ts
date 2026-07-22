import { Injectable, NotFoundException } from "@nestjs/common";
import {
  ERROR_CODES,
  PERIOD_DAYS,
  type AdminAnalyticsQuery,
  type AdminDistributionQuery,
  type PlatformMetric,
} from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { toCsv } from "../reports/reports.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** % change vs previous window; null when there's no base to compare against. */
const growthPct = (cur: number, prev: number): number | null =>
  prev > 0 ? round2(((cur - prev) / prev) * 100) : cur > 0 ? null : 0;

/**
 * Super-admin business analytics (docs/06). Everything runs under
 * service-bypass with EXPLICIT pharmacyId predicates (see decisions R6 —
 * RLS is a backstop, never the correctness layer).
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Platform overview — the "how is the business doing" screen. */
  async overview() {
    return this.prisma.withServiceBypass(async (tx) => {
      const d30 = new Date(Date.now() - 30 * DAY_MS);
      const [
        totalPharmacies,
        proSubscribers,
        blockedPharmacies,
        newPharmacies30d,
        totalCustomers,
        totalSales,
        revenueAll,
        revenue30,
        messages30d,
      ] = await Promise.all([
        tx.pharmacy.count(),
        tx.pharmacy.count({ where: { plan: "PRO" } }),
        tx.pharmacy.count({ where: { blockedAt: { not: null } } }),
        tx.pharmacy.count({ where: { createdAt: { gte: d30 } } }),
        tx.customer.count({ where: { deletedAt: null } }),
        tx.sale.count(),
        tx.sale.aggregate({ _sum: { totalEgp: true, discountEgp: true } }),
        tx.sale.aggregate({
          where: { createdAt: { gte: d30 } },
          _sum: { totalEgp: true, discountEgp: true },
          _count: { _all: true },
        }),
        tx.message.count({ where: { createdAt: { gte: d30 } } }),
      ]);

      // 12-month platform trend (revenue + sales + signups per month)
      const monthly = await tx.$queryRaw<
        { month: string; revenue: number | null; sales: bigint }[]
      >`
        SELECT to_char(date_trunc('month', s."createdAt"), 'YYYY-MM') AS month,
               SUM(s."totalEgp" - s."discountEgp") AS revenue,
               COUNT(*) AS sales
        FROM "Sale" s
        WHERE s."createdAt" >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1`;
      const signups = await tx.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT to_char(date_trunc('month', p."createdAt"), 'YYYY-MM') AS month, COUNT(*) AS count
        FROM "Pharmacy" p
        WHERE p."createdAt" >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1`;
      const signupByMonth = new Map(signups.map((r) => [r.month, Number(r.count)]));

      // zero-fill the 12 months so the chart never has holes
      const trend: { month: string; revenueEgp: number; salesCount: number; newPharmacies: number }[] = [];
      const now = new Date();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const row = monthly.find((m) => m.month === key);
        trend.push({
          month: key,
          revenueEgp: round2(Number(row?.revenue ?? 0)),
          salesCount: Number(row?.sales ?? 0),
          newPharmacies: signupByMonth.get(key) ?? 0,
        });
      }

      return {
        totalPharmacies,
        proSubscribers,
        freePharmacies: totalPharmacies - proSubscribers,
        blockedPharmacies,
        newPharmacies30d,
        totalCustomers,
        totalSales,
        totalRevenueEgp: round2(Number(revenueAll._sum.totalEgp ?? 0) - Number(revenueAll._sum.discountEgp ?? 0)),
        revenue30dEgp: round2(Number(revenue30._sum.totalEgp ?? 0) - Number(revenue30._sum.discountEgp ?? 0)),
        sales30d: revenue30._count._all,
        messages30d,
        monthlyTrend: trend,
      };
    });
  }

  /**
   * Per-pharmacy performance for a rolling window (day/week/month/year):
   * growth vs the previous window of the same length, top products/categories/
   * customers, and a zero-filled trend suitable for charts and CSV.
   */
  async pharmacyAnalytics(pharmacyId: string, query: AdminAnalyticsQuery) {
    // rolling presets end "now"; custom uses explicit [from..to] calendar days
    // and compares against the immediately preceding window of equal length.
    let curEnd = new Date();
    let days: number;
    if (query.period === "custom") {
      curEnd = new Date(`${query.to!}T23:59:59.999Z`);
      days = Math.max(
        1,
        Math.round((curEnd.getTime() - new Date(`${query.from!}T00:00:00Z`).getTime()) / DAY_MS),
      );
    } else {
      days = PERIOD_DAYS[query.period];
    }
    const now = curEnd.getTime();
    const curStart = new Date(now - days * DAY_MS);
    const prevStart = new Date(now - 2 * days * DAY_MS);

    return this.prisma.withServiceBypass(async (tx) => {
      const pharmacy = await tx.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: { id: true, name: true, city: true, plan: true, createdAt: true, blockedAt: true },
      });
      if (!pharmacy) {
        throw new NotFoundException({
          error: { code: ERROR_CODES.NOT_FOUND, message: "Pharmacy not found" },
        });
      }

      const windowAgg = (start: Date, end: Date) =>
        tx.sale.aggregate({
          where: { pharmacyId, createdAt: { gte: start, lt: end } },
          _sum: { totalEgp: true, discountEgp: true },
          _count: { _all: true },
        });
      const newCustomers = (start: Date, end: Date) =>
        tx.customer.count({ where: { pharmacyId, deletedAt: null, createdAt: { gte: start, lt: end } } });

      const [cur, prev, curNewCust, prevNewCust] = await Promise.all([
        windowAgg(curStart, new Date(now)),
        windowAgg(prevStart, curStart),
        newCustomers(curStart, new Date(now)),
        newCustomers(prevStart, curStart),
      ]);
      const curRevenue = round2(Number(cur._sum.totalEgp ?? 0) - Number(cur._sum.discountEgp ?? 0));
      const prevRevenue = round2(Number(prev._sum.totalEgp ?? 0) - Number(prev._sum.discountEgp ?? 0));

      // top products + categories from SaleItems in the window
      const items = await tx.saleItem.findMany({
        where: { sale: { pharmacyId, createdAt: { gte: curStart, lt: new Date(now) } } },
        select: {
          nameText: true,
          qty: true,
          unitPriceEgp: true,
          productRef: { select: { id: true, nameText: true, category: true } },
        },
      });
      const byProduct = new Map<string, { name: string; qty: number; revenueEgp: number }>();
      const byCategory = new Map<string, { qty: number; revenueEgp: number }>();
      for (const it of items) {
        const key = it.productRef?.id ?? it.nameText;
        const p = byProduct.get(key) ?? { name: it.productRef?.nameText ?? it.nameText, qty: 0, revenueEgp: 0 };
        p.qty += it.qty;
        p.revenueEgp += Number(it.unitPriceEgp) * it.qty;
        byProduct.set(key, p);
        const cat = it.productRef?.category ?? "غير مصنّف";
        const c = byCategory.get(cat) ?? { qty: 0, revenueEgp: 0 };
        c.qty += it.qty;
        c.revenueEgp += Number(it.unitPriceEgp) * it.qty;
        byCategory.set(cat, c);
      }
      const topProducts = [...byProduct.values()]
        .map((p) => ({ ...p, revenueEgp: round2(p.revenueEgp) }))
        .sort((a, b) => b.revenueEgp - a.revenueEgp)
        .slice(0, 5);
      const topCategories = [...byCategory.entries()]
        .map(([category, v]) => ({ category, qty: v.qty, revenueEgp: round2(v.revenueEgp) }))
        .sort((a, b) => b.revenueEgp - a.revenueEgp)
        .slice(0, 5);

      // top customers by spend in the window
      const custAgg = await tx.sale.groupBy({
        by: ["customerId"],
        where: { pharmacyId, createdAt: { gte: curStart, lt: new Date(now) } },
        _sum: { totalEgp: true, discountEgp: true },
        _count: { _all: true },
      });
      const custIds = custAgg
        .sort((a, b) => Number(b._sum.totalEgp ?? 0) - Number(a._sum.totalEgp ?? 0))
        .slice(0, 5)
        .map((c) => c.customerId);
      const custNames = await tx.customer.findMany({
        where: { id: { in: custIds } },
        select: { id: true, name: true, phone: true },
      });
      const nameById = new Map(custNames.map((c) => [c.id, c]));
      const topCustomers = custIds.map((id) => {
        const agg = custAgg.find((c) => c.customerId === id)!;
        return {
          customerId: id,
          name: nameById.get(id)?.name ?? "—",
          phone: nameById.get(id)?.phone ?? "",
          salesCount: agg._count._all,
          spendEgp: round2(Number(agg._sum.totalEgp ?? 0) - Number(agg._sum.discountEgp ?? 0)),
        };
      });

      // trend buckets: monthly for year, daily otherwise — zero-filled
      const trend =
        query.period === "year"
          ? await this.monthlyTrend(tx, pharmacyId)
          : await this.dailyTrend(tx, pharmacyId, days, new Date(now));

      return {
        pharmacy: { ...pharmacy, joinedAt: pharmacy.createdAt },
        period: query.period,
        windowDays: days,
        current: {
          revenueEgp: curRevenue,
          salesCount: cur._count._all,
          avgBasketEgp: cur._count._all ? round2(curRevenue / cur._count._all) : 0,
          newCustomers: curNewCust,
        },
        previous: {
          revenueEgp: prevRevenue,
          salesCount: prev._count._all,
          newCustomers: prevNewCust,
        },
        growth: {
          revenuePct: growthPct(curRevenue, prevRevenue),
          salesPct: growthPct(cur._count._all, prev._count._all),
          newCustomersPct: growthPct(curNewCust, prevNewCust),
        },
        topProducts,
        topCategories,
        topCustomers,
        trend,
      };
    });
  }

  private async dailyTrend(tx: any, pharmacyId: string, days: number, end: Date = new Date()) {
    const start = new Date(end.getTime() - days * DAY_MS);
    const rows: { day: string; revenue: number | null; sales: bigint }[] = await tx.$queryRaw`
      SELECT to_char(date_trunc('day', s."createdAt"), 'YYYY-MM-DD') AS day,
             SUM(s."totalEgp" - s."discountEgp") AS revenue,
             COUNT(*) AS sales
      FROM "Sale" s
      WHERE s."pharmacyId" = ${pharmacyId} AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
      GROUP BY 1 ORDER BY 1`;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: { bucket: string; revenueEgp: number; salesCount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(end.getTime() - i * DAY_MS).toISOString().slice(0, 10);
      const row = byDay.get(key);
      out.push({
        bucket: key,
        revenueEgp: round2(Number(row?.revenue ?? 0)),
        salesCount: Number(row?.sales ?? 0),
      });
    }
    return out;
  }

  private async monthlyTrend(tx: any, pharmacyId: string) {
    const rows: { month: string; revenue: number | null; sales: bigint }[] = await tx.$queryRaw`
      SELECT to_char(date_trunc('month', s."createdAt"), 'YYYY-MM') AS month,
             SUM(s."totalEgp" - s."discountEgp") AS revenue,
             COUNT(*) AS sales
      FROM "Sale" s
      WHERE s."pharmacyId" = ${pharmacyId}
        AND s."createdAt" >= date_trunc('month', NOW()) - INTERVAL '11 months'
      GROUP BY 1 ORDER BY 1`;
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const out: { bucket: string; revenueEgp: number; salesCount: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const row = byMonth.get(key);
      out.push({
        bucket: key,
        revenueEgp: round2(Number(row?.revenue ?? 0)),
        salesCount: Number(row?.sales ?? 0),
      });
    }
    return out;
  }

  /** Block / unblock — the enforcement lives in auth (login + refresh). */
  async setBlocked(
    pharmacyId: string,
    blocked: boolean,
    adminId: string,
    reason?: string,
    note?: string,
  ) {
    return this.prisma.withServiceBypass(async (tx) => {
      const pharmacy = await tx.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: { blockedAt: true, name: true },
      });
      if (!pharmacy) {
        throw new NotFoundException({
          error: { code: ERROR_CODES.NOT_FOUND, message: "Pharmacy not found" },
        });
      }
      const updated = await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { blockedAt: blocked ? new Date() : null },
        select: { id: true, name: true, blockedAt: true },
      });
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: `admin:${adminId}`,
          action: blocked ? "PHARMACY_BLOCK" : "PHARMACY_UNBLOCK",
          entity: "Pharmacy",
          entityId: pharmacyId,
          diff: { blocked, ...(reason ? { reason } : {}), ...(note ? { note } : {}) },
        },
      });
      return updated;
    });
  }

  /** Full pharmacy directory as flat CSV — Excel / Power BI ready. */
  async pharmaciesCsv(): Promise<{ filename: string; csv: string }> {
    return this.prisma.withServiceBypass(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string; name: string; city: string | null; plan: string;
          blockedAt: Date | null; createdAt: Date;
          customers: bigint; users: bigint; salesAll: bigint;
          revenueAll: number | null; sales30d: bigint; revenue30d: number | null;
          lastActive: Date | null;
        }[]
      >`
        SELECT p.id, p.name, p.city, p.plan::text AS plan, p."blockedAt", p."createdAt",
               (SELECT COUNT(*) FROM "Customer" c WHERE c."pharmacyId" = p.id AND c."deletedAt" IS NULL) AS customers,
               (SELECT COUNT(*) FROM "User" u WHERE u."pharmacyId" = p.id) AS users,
               (SELECT COUNT(*) FROM "Sale" s WHERE s."pharmacyId" = p.id) AS "salesAll",
               (SELECT SUM(s."totalEgp" - s."discountEgp") FROM "Sale" s WHERE s."pharmacyId" = p.id) AS "revenueAll",
               (SELECT COUNT(*) FROM "Sale" s WHERE s."pharmacyId" = p.id AND s."createdAt" >= NOW() - INTERVAL '30 days') AS sales30d,
               (SELECT SUM(s."totalEgp" - s."discountEgp") FROM "Sale" s WHERE s."pharmacyId" = p.id AND s."createdAt" >= NOW() - INTERVAL '30 days') AS revenue30d,
               (SELECT MAX(s."createdAt") FROM "Sale" s WHERE s."pharmacyId" = p.id) AS "lastActive"
        FROM "Pharmacy" p ORDER BY p."createdAt"`;
      const csv = toCsv([
        ["pharmacy_id", "name", "city", "plan", "blocked", "joined_at", "customers", "users",
         "sales_total", "revenue_total_egp", "sales_30d", "revenue_30d_egp", "last_active"],
        ...rows.map((r) => [
          r.id, r.name, r.city ?? "", r.plan, r.blockedAt ? "yes" : "no",
          r.createdAt.toISOString().slice(0, 10),
          Number(r.customers), Number(r.users), Number(r.salesAll),
          round2(Number(r.revenueAll ?? 0)), Number(r.sales30d),
          round2(Number(r.revenue30d ?? 0)),
          r.lastActive?.toISOString().slice(0, 10) ?? "",
        ]),
      ]);
      return { filename: `pharmacies_${new Date().toISOString().slice(0, 10)}.csv`, csv };
    });
  }

  /** Per-pharmacy time series CSV for the chosen period — feeds Power BI/Excel. */
  async analyticsCsv(pharmacyId: string, query: AdminAnalyticsQuery) {
    const data = await this.pharmacyAnalytics(pharmacyId, query);
    const csv = toCsv([
      ["bucket", "revenue_egp", "sales_count"],
      ...data.trend.map((t) => [t.bucket, t.revenueEgp, t.salesCount]),
    ]);
    return {
      filename: `pharmacy_${pharmacyId}_${query.period}.csv`,
      csv,
    };
  }

  /** Platform overview as CSV: KPI block + 12-month trend — one import for a BI model. */
  async overviewCsv(): Promise<{ filename: string; csv: string }> {
    const o = await this.overview();
    const csv = toCsv([
      ["metric", "value"],
      ["total_pharmacies", o.totalPharmacies],
      ["pro_subscribers", o.proSubscribers],
      ["free_pharmacies", o.freePharmacies],
      ["blocked_pharmacies", o.blockedPharmacies],
      ["new_pharmacies_30d", o.newPharmacies30d],
      ["total_customers", o.totalCustomers],
      ["total_sales", o.totalSales],
      ["total_revenue_egp", o.totalRevenueEgp],
      ["revenue_30d_egp", o.revenue30dEgp],
      ["sales_30d", o.sales30d],
      ["messages_30d", o.messages30d],
      [],
      ["month", "revenue_egp", "sales_count", "new_pharmacies"],
      ...o.monthlyTrend.map((m) => [m.month, m.revenueEgp, m.salesCount, m.newPharmacies]),
    ]);
    return { filename: `platform_overview_${new Date().toISOString().slice(0, 10)}.csv`, csv };
  }

  /** Messaging ops per pharmacy (30d) as CSV. */
  async messagingCsv(): Promise<{ filename: string; csv: string }> {
    return this.prisma.withServiceBypass(async (tx) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await tx.$queryRaw<
        { pharmacyId: string; name: string; total: bigint; delivered: bigint; failed: bigint; fallbacks: bigint; costMicro: bigint | null }[]
      >`
        SELECT m."pharmacyId", p.name,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE m.status IN ('DELIVERED','READ')) AS delivered,
               COUNT(*) FILTER (WHERE m.status = 'FAILED') AS failed,
               COUNT(*) FILTER (WHERE m.status = 'FALLBACK_TRIGGERED') AS fallbacks,
               SUM(m."costMicro") AS "costMicro"
        FROM "Message" m JOIN "Pharmacy" p ON p.id = m."pharmacyId"
        WHERE m."createdAt" >= ${since}
        GROUP BY m."pharmacyId", p.name ORDER BY total DESC`;
      const csv = toCsv([
        ["pharmacy_id", "name", "messages_30d", "delivered", "failed", "fallbacks", "cost_egp"],
        ...rows.map((r) => [
          r.pharmacyId, r.name, Number(r.total), Number(r.delivered), Number(r.failed),
          Number(r.fallbacks), round2(Number(r.costMicro ?? 0) / 1_000_000),
        ]),
      ]);
      return { filename: `messaging_30d_${new Date().toISOString().slice(0, 10)}.csv`, csv };
    });
  }

  /** Audit trail (latest 500) as CSV. */
  async auditCsv(): Promise<{ filename: string; csv: string }> {
    return this.prisma.withServiceBypass(async (tx) => {
      const rows = await tx.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { pharmacy: { select: { name: true } } },
      });
      const csv = toCsv([
        ["at", "pharmacy", "action", "entity", "entity_id", "actor", "diff"],
        ...rows.map((a) => [
          a.createdAt.toISOString(), a.pharmacy.name, a.action, a.entity, a.entityId,
          a.userId, JSON.stringify(a.diff),
        ]),
      ]);
      return { filename: `audit_${new Date().toISOString().slice(0, 10)}.csv`, csv };
    });
  }

  // ===================== metric definition layer =====================
  // Single implementation for every widget/export (docs/metrics.md is the
  // human contract). [from..to] are inclusive calendar days; the comparison
  // window is the immediately preceding window of equal length.

  private windowBounds(from: string, to: string) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T23:59:59.999Z`);
    const spanMs = end.getTime() - start.getTime();
    return { start, end, prevStart: new Date(start.getTime() - spanMs), prevEnd: start };
  }

  /** KPI block: current vs previous window. previous=null → "No comparison data". */
  async platformKpis(from: string, to: string) {
    const { start, end, prevStart, prevEnd } = this.windowBounds(from, to);
    return this.prisma.withServiceBypass(async (tx) => {
      const saleAgg = (s: Date, e: Date) =>
        tx.sale.aggregate({
          where: { createdAt: { gte: s, lt: e } },
          _sum: { totalEgp: true, discountEgp: true },
          _count: { _all: true },
        });
      const count = (model: "customer" | "pharmacy" | "message", s: Date, e: Date) =>
        (tx as any)[model].count({
          where: {
            createdAt: { gte: s, lt: e },
            ...(model === "customer" ? { deletedAt: null } : {}),
          },
        });

      const [cur, prev, curCust, prevCust, curPh, prevPh, curMsg, prevMsg,
        totalPharmacies, proSubscribers, blockedPharmacies, totalCustomers, activePharmacies] =
        await Promise.all([
          saleAgg(start, end), saleAgg(prevStart, prevEnd),
          count("customer", start, end), count("customer", prevStart, prevEnd),
          count("pharmacy", start, end), count("pharmacy", prevStart, prevEnd),
          count("message", start, end), count("message", prevStart, prevEnd),
          tx.pharmacy.count(),
          tx.pharmacy.count({ where: { plan: "PRO" } }),
          tx.pharmacy.count({ where: { blockedAt: { not: null } } }),
          tx.customer.count({ where: { deletedAt: null } }),
          tx.sale.findMany({
            where: { createdAt: { gte: start, lt: end } },
            select: { pharmacyId: true },
            distinct: ["pharmacyId"],
          }).then((r: unknown[]) => r.length),
        ]);

      const rev = (a: typeof cur) =>
        round2(Number(a._sum.totalEgp ?? 0) - Number(a._sum.discountEgp ?? 0));
      const kpi = (current: number, previous: number | null) => ({
        current,
        previous,
        growthPct: previous === null ? null : growthPct(current, previous),
      });
      const curRev = rev(cur);
      const prevRev = rev(prev);
      const curAov = cur._count._all ? round2(curRev / cur._count._all) : 0;
      const prevAov = prev._count._all ? round2(prevRev / prev._count._all) : 0;

      return {
        range: { from, to },
        // point-in-time metrics have no window comparison → previous:null
        revenue: kpi(curRev, prevRev),
        sales: kpi(cur._count._all, prev._count._all),
        avgOrderValue: kpi(curAov, prev._count._all ? prevAov : null),
        newCustomers: kpi(curCust, prevCust),
        newPharmacies: kpi(curPh, prevPh),
        messages: kpi(curMsg, prevMsg),
        activePharmacies: kpi(activePharmacies, null),
        totalPharmacies: kpi(totalPharmacies, null),
        totalCustomers: kpi(totalCustomers, null),
        proSubscribers: kpi(proSubscribers, null),
        freeSubscribers: kpi(totalPharmacies - proSubscribers, null),
        blockedPharmacies: kpi(blockedPharmacies, null),
        conversionRatePct: kpi(
          totalPharmacies ? round2((proSubscribers / totalPharmacies) * 100) : 0,
          null,
        ),
      };
    });
  }

  /** Metric × time series. Buckets: daily ≤92d, else monthly. Zero-filled. */
  async platformSeries(metric: PlatformMetric, from: string, to: string) {
    const { start, end } = this.windowBounds(from, to);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    const monthly = days > 92;

    return this.prisma.withServiceBypass(async (tx) => {
      let rows: { createdAt: Date; value: number }[];
      if (metric === "revenue" || metric === "sales") {
        const sales = await tx.sale.findMany({
          where: { createdAt: { gte: start, lt: end } },
          select: { createdAt: true, totalEgp: true, discountEgp: true },
        });
        rows = sales.map((s) => ({
          createdAt: s.createdAt,
          value: metric === "revenue" ? Number(s.totalEgp) - Number(s.discountEgp) : 1,
        }));
      } else {
        const model = metric === "customers" ? tx.customer : metric === "pharmacies" ? tx.pharmacy : tx.message;
        const recs = await (model as any).findMany({
          where: {
            createdAt: { gte: start, lt: end },
            ...(metric === "customers" ? { deletedAt: null } : {}),
          },
          select: { createdAt: true },
        });
        rows = recs.map((r: { createdAt: Date }) => ({ createdAt: r.createdAt, value: 1 }));
      }

      const keyOf = (d: Date) => (monthly ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10));
      const sums = new Map<string, number>();
      for (const r of rows) sums.set(keyOf(r.createdAt), (sums.get(keyOf(r.createdAt)) ?? 0) + r.value);

      const buckets: { bucket: string; value: number }[] = [];
      if (monthly) {
        const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        while (cur < end) {
          const key = cur.toISOString().slice(0, 7);
          buckets.push({ bucket: key, value: round2(sums.get(key) ?? 0) });
          cur.setUTCMonth(cur.getUTCMonth() + 1);
        }
      } else {
        for (let i = 0; i < days; i++) {
          const key = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
          buckets.push({ bucket: key, value: round2(sums.get(key) ?? 0) });
        }
      }
      return { metric, granularity: monthly ? "month" : "day", buckets };
    });
  }

  /** Metric distribution across a dimension — feeds donut/bar/table. */
  async distribution(q: AdminDistributionQuery) {
    const { start, end } = this.windowBounds(q.from, q.to);
    return this.prisma.withServiceBypass(async (tx) => {
      let slices: { label: string; value: number }[] = [];

      if (q.metric === "subscribers" || q.by === "plan") {
        if (q.metric === "subscribers" || q.metric === "customers") {
          // point-in-time split FREE vs PRO (subscribers) or customers per plan
          const [free, pro] = await Promise.all([
            q.metric === "subscribers"
              ? tx.pharmacy.count({ where: { plan: "FREE" } })
              : tx.customer.count({ where: { deletedAt: null, pharmacy: { plan: "FREE" } } }),
            q.metric === "subscribers"
              ? tx.pharmacy.count({ where: { plan: "PRO" } })
              : tx.customer.count({ where: { deletedAt: null, pharmacy: { plan: "PRO" } } }),
          ]);
          slices = [
            { label: "FREE", value: free },
            { label: "PRO", value: pro },
          ];
        } else {
          const sales = await tx.sale.findMany({
            where: { createdAt: { gte: start, lt: end } },
            select: { totalEgp: true, discountEgp: true, pharmacy: { select: { plan: true } } },
          });
          const m = new Map<string, number>();
          for (const s of sales) {
            const v = q.metric === "revenue" ? Number(s.totalEgp) - Number(s.discountEgp) : 1;
            m.set(s.pharmacy.plan, (m.get(s.pharmacy.plan) ?? 0) + v);
          }
          slices = [...m.entries()].map(([label, value]) => ({ label, value: round2(value) }));
        }
      } else if (q.by === "category") {
        const items = await tx.saleItem.findMany({
          where: { sale: { createdAt: { gte: start, lt: end } } },
          select: { qty: true, unitPriceEgp: true, productRef: { select: { category: true } } },
        });
        const m = new Map<string, number>();
        for (const it of items) {
          const cat = it.productRef?.category ?? "غير مصنّف";
          const v = q.metric === "revenue" ? Number(it.unitPriceEgp) * it.qty : it.qty;
          m.set(cat, (m.get(cat) ?? 0) + v);
        }
        slices = [...m.entries()].map(([label, value]) => ({ label, value: round2(value) }));
      } else {
        // by pharmacy
        if (q.metric === "customers" || q.metric === "messages") {
          const model = q.metric === "customers" ? tx.customer : tx.message;
          const recs = await (model as any).groupBy({
            by: ["pharmacyId"],
            where: {
              ...(q.metric === "customers"
                ? { deletedAt: null }
                : { createdAt: { gte: start, lt: end } }),
            },
            _count: { _all: true },
          });
          const names = await tx.pharmacy.findMany({ select: { id: true, name: true } });
          const nameById = new Map(names.map((p) => [p.id, p.name]));
          slices = recs.map((r: any) => ({
            label: nameById.get(r.pharmacyId) ?? r.pharmacyId,
            value: r._count._all,
          }));
        } else {
          const sales = await tx.sale.findMany({
            where: { createdAt: { gte: start, lt: end } },
            select: { totalEgp: true, discountEgp: true, pharmacy: { select: { name: true } } },
          });
          const m = new Map<string, number>();
          for (const s of sales) {
            const v = q.metric === "revenue" ? Number(s.totalEgp) - Number(s.discountEgp) : 1;
            m.set(s.pharmacy.name, (m.get(s.pharmacy.name) ?? 0) + v);
          }
          slices = [...m.entries()].map(([label, value]) => ({ label, value: round2(value) }));
        }
      }

      slices.sort((a, b) => b.value - a.value);
      return { metric: q.metric, by: q.by, range: { from: q.from, to: q.to }, slices: slices.slice(0, 12) };
    });
  }

  /**
   * Multi-sheet Excel export (SpreadsheetML 2003 .xls — typed Number/String
   * cells, no formatting-as-data, zero new dependencies). Sheets: Summary,
   * Revenue_Trend, Pharmacies, Sales_By_Category, Subscriptions.
   * Respects the SAME [from..to] filter as the dashboard.
   */
  async exportXls(from: string, to: string): Promise<{ filename: string; xml: string }> {
    const [kpis, series, byCategory, byPlan, pharmaciesCsv] = await Promise.all([
      this.platformKpis(from, to),
      this.platformSeries("revenue", from, to),
      this.distribution({ metric: "revenue", by: "category", from, to }),
      this.distribution({ metric: "subscribers", by: "plan", from, to }),
      this.pharmaciesCsv(),
    ]);

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const cell = (v: string | number | null | undefined) =>
      typeof v === "number"
        ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${esc(String(v ?? ""))}</Data></Cell>`;
    const row = (cells: (string | number | null | undefined)[]) =>
      `<Row>${cells.map(cell).join("")}</Row>`;
    const sheet = (name: string, rows: (string | number | null | undefined)[][]) =>
      `<Worksheet ss:Name="${esc(name)}"><Table>${rows.map(row).join("")}</Table></Worksheet>`;

    const { range: _range, ...kpiBlock } = kpis;
    const kpiRows: (string | number | null)[][] = [
      ["metric", "current", "previous", "growth_pct", "period_from", "period_to"],
      ...Object.entries(kpiBlock).map(([key, v]) => [key, v.current, v.previous, v.growthPct, from, to]),
    ];

    // pharmacies sheet reuses the directory CSV rows (already raw values)
    const dirRows = pharmaciesCsv.csv
      .replace(/^﻿/, "")
      .split("\r\n")
      .map((line) =>
        line.split(",").map((c) => {
          const unquoted = c.replace(/^"|"$/g, "").replace(/""/g, '"');
          return /^-?\d+(\.\d+)?$/.test(unquoted) ? Number(unquoted) : unquoted;
        }),
      );

    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheet("Summary", kpiRows)}
${sheet("Revenue_Trend", [["bucket", "revenue_egp"], ...series.buckets.map((b) => [b.bucket, b.value])])}
${sheet("Pharmacies", dirRows)}
${sheet("Sales_By_Category", [["category", "revenue_egp"], ...byCategory.slices.map((s) => [s.label, s.value])])}
${sheet("Subscriptions", [["plan", "pharmacies"], ...byPlan.slices.map((s) => [s.label, s.value])])}
</Workbook>`;
    return { filename: `pharmacrm_report_${from}_${to}.xls`, xml };
  }
}
