"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, downloadCsv } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_STYLE,
  type CampaignRow,
} from "@/lib/campaigns";

interface CampaignReport {
  campaign: Omit<CampaignRow, "_count">;
  totals: {
    messages: number;
    sent: number;
    delivered: number;
    failed: number;
    skippedOptOut: number;
    convertedCustomers: number;
    costEgp: number;
  };
  byStatus: Record<string, number>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-center">
      <div className={`text-2xl font-bold ${tone ?? "text-slate-800"}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

/** S53 — campaign report: funnel + conversions + cost + per-recipient CSV. */
export default function CampaignReportPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useAppStore();
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns", id, "report"],
    queryFn: () => api<CampaignReport>(`/campaigns/${id}/report`),
    refetchInterval: (q) => (q.state.data?.campaign.status === "SENDING" ? 5_000 : false),
  });

  const cancel = useMutation({
    mutationFn: () => api(`/campaigns/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast("تم إلغاء الحملة", "success");
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: () => toast("تعذّر الإلغاء", "error"),
  });

  if (isLoading) return <p className="text-slate-400">جارٍ التحميل…</p>;
  if (isError || !data) return <p className="text-red-600">تعذّر تحميل التقرير</p>;

  const { campaign, totals } = data;
  const deliveryRate = totals.sent > 0 ? Math.round((totals.delivered / totals.sent) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/campaigns" className="text-sm text-emerald-700 hover:underline">‹ الحملات</Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_STYLE[campaign.status]}`}>
              {CAMPAIGN_STATUS_LABEL[campaign.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">قالب: {campaign.templateName}</p>
        </div>
        <div className="flex gap-2">
          {["DRAFT", "SCHEDULED", "SENDING"].includes(campaign.status) && (
            <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
              إلغاء الحملة
            </button>
          )}
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await downloadCsv(`/reports/campaigns/${id}.csv`, "campaign.csv");
              } catch {
                toast("تعذّر التنزيل", "error");
              } finally {
                setDownloading(false);
              }
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {downloading ? "جارٍ التنزيل…" : "⬇ CSV"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-bold text-slate-900">النتائج</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Stat label="إجمالي الرسائل" value={arDigits(totals.messages)} />
          <Stat label="أُرسلت" value={arDigits(totals.sent)} tone="text-emerald-700" />
          <Stat label="نسبة التسليم" value={`${arDigits(deliveryRate)}٪`} tone="text-sky-700" />
          <Stat label="فشلت" value={arDigits(totals.failed)} tone={totals.failed > 0 ? "text-red-600" : undefined} />
          <Stat label="استُبعدوا (إيقاف الرسائل)" value={arDigits(totals.skippedOptOut)} tone="text-amber-700" />
          <Stat label="التكلفة" value={egp(totals.costEgp)} />
        </div>
      </div>

      <div className="rounded-2xl bg-emerald-50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-emerald-900">التحويل — زاروا الصيدلية خلال ٧ أيام</h2>
            <p className="mt-1 text-sm text-emerald-700">عملاء استقبلوا الحملة ثم سجّلت لهم عملية شراء</p>
          </div>
          <div className="text-4xl font-bold text-emerald-700">{arDigits(totals.convertedCustomers)}</div>
        </div>
      </div>
    </div>
  );
}
