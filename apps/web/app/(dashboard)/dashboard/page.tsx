"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, downloadCsv } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { TrendChart } from "@/components/trend-chart";

interface TrendPoint {
  date: string;
  salesCount: number;
  salesEgp: number;
}
interface DashboardSummary {
  todaySalesCount: number;
  todaySalesEgp: number;
  activeCustomers: number;
  inactiveCustomers: number;
  lowStockCount: number;
  pointsRedeemedThisMonth: number;
  trend: TrendPoint[];
  topProducts: { productRefId: string; nameText: string; qty: number; revenueEgp: number }[];
  lowStockItems: { id: string; nameText: string; stock: number; category: string | null }[];
  topCustomers: { customerId: string; name: string; salesCount: number; spendEgp: number }[];
  upcomingRefillRevenueEgp30d: number;
  expectedVisits7d: {
    count: number;
    customers: { customerId: string; name: string; expectedAt: string; avgIntervalDays: number }[];
  };
}

const dayFmt = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long" });

function StatCard({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

/** S10 dashboard — stat cards + trend + top products/customers + forecasts + CSV export. */
export default function DashboardPage() {
  const { toast } = useAppStore();
  const [downloading, setDownloading] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "summary", 14],
    queryFn: () => api<DashboardSummary>("/dashboard/summary?days=14"),
  });

  if (isLoading) return <p className="text-slate-400">جارٍ التحميل…</p>;
  if (isError || !data) return <p className="text-red-600">تعذر تحميل لوحة التحكم</p>;

  const windowTotal = data.trend.reduce((s, d) => s + d.salesEgp, 0);

  const exportSales = async () => {
    setDownloading(true);
    try {
      await downloadCsv("/reports/sales.csv", "sales.csv");
      toast("تم تنزيل تقرير المبيعات", "success");
    } catch {
      toast("تعذّر تنزيل التقرير", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">لوحة التحكم</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={exportSales}
            disabled={downloading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {downloading ? "جارٍ التنزيل…" : "⬇ تقرير المبيعات (CSV)"}
          </button>
          <span className="text-sm text-slate-400">آخر ١٤ يومًا</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="مبيعات اليوم" value={egp(data.todaySalesEgp)} accent="text-emerald-600" sub={`${arDigits(data.todaySalesCount)} عملية`} />
        <StatCard label="عملاء نشطون" value={arDigits(data.activeCustomers)} sub={`${arDigits(data.inactiveCustomers)} غير نشط`} />
        <StatCard label="أدوية منخفضة المخزون" value={arDigits(data.lowStockCount)} accent={data.lowStockCount > 0 ? "text-red-600" : "text-slate-900"} sub="٥ وحدات أو أقل" />
        <StatCard label="إيراد متوقع (٣٠ يوم)" value={egp(Math.round(data.upcomingRefillRevenueEgp30d))} accent="text-sky-600" sub="من تذكيرات إعادة الصرف" />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">اتجاه المبيعات</h2>
          <span className="text-sm text-slate-500">الإجمالي: {egp(Math.round(windowTotal))}</span>
        </div>
        <TrendChart data={data.trend} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-bold text-slate-900">الأكثر مبيعًا</h2>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-slate-400">لا مبيعات في هذه الفترة</p>
          ) : (
            <ul className="space-y-3">
              {data.topProducts.map((p, i) => (
                <li key={p.productRefId} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{arDigits(i + 1)}</span>
                    <span className="text-sm text-slate-700">{p.nameText}</span>
                  </span>
                  <span className="text-sm text-slate-500">{arDigits(p.qty)} وحدة · {egp(Math.round(p.revenueEgp))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">مخزون منخفض</h2>
            <Link href="/catalog" className="text-sm text-emerald-700 hover:underline">دليل الأدوية</Link>
          </div>
          {data.lowStockItems.length === 0 ? (
            <p className="text-sm text-slate-400">المخزون بحالة جيدة 👍</p>
          ) : (
            <ul className="space-y-2">
              {data.lowStockItems.map((it) => (
                <li key={it.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{it.nameText}{it.category && <span className="mr-2 text-xs text-slate-400">{it.category}</span>}</span>
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">{arDigits(it.stock)} متبقٍ</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* CTO: top spenders — who funds the pharmacy */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">أفضل العملاء</h2>
            <Link href="/customers" className="text-sm text-emerald-700 hover:underline">كل العملاء</Link>
          </div>
          {data.topCustomers.length === 0 ? (
            <p className="text-sm text-slate-400">لا مبيعات في هذه الفترة</p>
          ) : (
            <ul className="space-y-3">
              {data.topCustomers.map((c, i) => (
                <li key={c.customerId}>
                  <Link href={`/customers/${c.customerId}`} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-slate-50">
                    <span className="flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-50 text-xs font-bold text-amber-700">{arDigits(i + 1)}</span>
                      <span className="text-sm text-slate-700">{c.name}</span>
                    </span>
                    <span className="text-sm text-slate-500">{arDigits(c.salesCount)} عملية · {egp(Math.round(c.spendEgp))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* CTO: payment-cycle prediction — who is due to walk in this week */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-1 font-bold text-slate-900">متوقع قدومهم هذا الأسبوع</h2>
          <p className="mb-4 text-xs text-slate-400">تنبؤ من متوسط دورة الشراء لكل عميل</p>
          {data.expectedVisits7d.count === 0 ? (
            <p className="text-sm text-slate-400">لا توقعات بعد — تُبنى مع تكرار المشتريات</p>
          ) : (
            <ul className="space-y-2">
              {data.expectedVisits7d.customers.map((c) => (
                <li key={c.customerId}>
                  <Link href={`/customers/${c.customerId}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 hover:bg-slate-100">
                    <span className="text-sm text-slate-700">{c.name}</span>
                    <span className="text-xs text-slate-500">{dayFmt.format(new Date(c.expectedAt))} · كل {arDigits(Math.round(c.avgIntervalDays))} يوم</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
