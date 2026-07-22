import { Injectable, NotFoundException } from "@nestjs/common";
import { ERROR_CODES, type ReportRangeQuery } from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { cairoDayKey, cairoDayRange, cairoTodayKey } from "../sales/sales.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** RFC-4180 escaping; ﻿ BOM so Excel opens Arabic UTF-8 correctly. */
const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]): string =>
  "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

/**
 * CTO reports — CSV downloads (sales journal, customer base, campaign
 * results). Tenant-scoped like every other module; the FE fetches with the
 * bearer token and saves the blob.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sales journal for a Cairo-day range (default: last 30 days). */
  async salesCsv(range: ReportRangeQuery): Promise<{ filename: string; csv: string }> {
    const to = range.to ?? cairoTodayKey();
    const from = range.from ?? cairoDayKey(new Date(Date.now() - 29 * DAY_MS));
    const start = cairoDayRange(from).start;
    const end = cairoDayRange(to).end;

    const sales = await this.prisma.tenant.sale.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      include: {
        customer: { select: { name: true, phone: true } },
        items: { select: { nameText: true, qty: true, unitPriceEgp: true } },
      },
    });

    const rows: unknown[][] = [
      ["التاريخ", "رقم الفاتورة", "العميل", "الموبايل", "الأصناف", "الإجمالي", "الخصم", "الصافي", "ملاحظات"],
      ...sales.map((s) => [
        cairoDayKey(s.createdAt),
        s.invoiceNo ?? "",
        s.customer.name,
        s.customer.phone,
        s.items.map((it) => `${it.nameText} ×${it.qty}`).join(" | "),
        Number(s.totalEgp).toFixed(2),
        Number(s.discountEgp).toFixed(2),
        (Number(s.totalEgp) - Number(s.discountEgp)).toFixed(2),
        s.notes ?? "",
      ]),
    ];
    return { filename: `sales_${from}_${to}.csv`, csv: toCsv(rows) };
  }

  /** Customer base incl. lifetime spend — the CRM asset, exportable. */
  async customersCsv(): Promise<{ filename: string; csv: string }> {
    const customers = await this.prisma.tenant.customer.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { sales: { select: { totalEgp: true, discountEgp: true } } },
    });
    const rows: unknown[][] = [
      ["الاسم", "الموبايل", "الوسوم", "النقاط", "آخر زيارة", "إجمالي المشتريات", "عدد الفواتير", "الرسائل"],
      ...customers.map((c) => [
        c.name,
        c.phone,
        c.tags.join(" | "),
        c.pointsBalance,
        c.lastVisitAt ? cairoDayKey(c.lastVisitAt) : "",
        c.sales.reduce((s, x) => s + Number(x.totalEgp) - Number(x.discountEgp), 0).toFixed(2),
        c.sales.length,
        c.optedOutAt ? "موقوفة" : "مفعّلة",
      ]),
    ];
    return { filename: `customers_${cairoTodayKey()}.csv`, csv: toCsv(rows) };
  }

  /** Per-recipient campaign outcome. */
  async campaignCsv(campaignId: string): Promise<{ filename: string; csv: string }> {
    const campaign = await this.prisma.tenant.campaign.findFirst({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: ERROR_CODES.NOT_FOUND, message: "Campaign not found" },
      });
    }
    const messages = await this.prisma.tenant.message.findMany({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
      include: { customer: { select: { name: true, phone: true } } },
    });
    const rows: unknown[][] = [
      ["العميل", "الموبايل", "القناة", "الحالة", "وقت الإرسال"],
      ...messages.map((m) => [
        m.customer.name,
        m.customer.phone,
        m.channel,
        m.status,
        m.sentAt?.toISOString() ?? "",
      ]),
    ];
    return { filename: `campaign_${campaignId}.csv`, csv: toCsv(rows) };
  }
}
