"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, getRole } from "@/lib/api";
import { arDigits } from "@/lib/format";
import {
  CAMPAIGN_STATUS_LABEL as STATUS_LABEL,
  CAMPAIGN_STATUS_STYLE as STATUS_STYLE,
  type CampaignRow,
} from "@/lib/campaigns";

const dateFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** S50 — campaigns list (OWNER-only feature; STAFF gets 403 from the API). */
export default function CampaignsPage() {
  const isOwner = getRole() === "OWNER";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns", "list"],
    queryFn: () => api<CampaignRow[]>("/campaigns"),
    enabled: isOwner,
    refetchInterval: 15_000, // SENDING → SENT progresses in the background
  });

  if (!isOwner) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-slate-500 shadow-sm">
        الحملات التسويقية متاحة لصاحب الصيدلية فقط
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">الحملات التسويقية</h1>
          <p className="mt-1 text-sm text-slate-500">رسائل واتساب مستهدفة لشرائح من عملائك — بقوالب معتمدة فقط.</p>
        </div>
        <Link
          href="/campaigns/new"
          className="rounded-lg bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm hover:bg-emerald-700"
        >
          + حملة جديدة
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {isLoading ? (
          <p className="p-6 text-slate-400">جارٍ التحميل…</p>
        ) : isError ? (
          <p className="p-6 text-red-600">تعذّر تحميل الحملات</p>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <p className="text-lg">لا حملات بعد</p>
            <p className="mt-1 text-sm">ابدأ أول حملة لاسترجاع عملائك الغائبين</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">الحملة</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">المستهدفون</th>
                <th className="px-4 py-3 font-medium">الرسائل</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data!.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/campaigns/${c.id}`} className="font-medium text-emerald-700 hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-slate-400">{c.templateName}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.recipientCount != null ? arDigits(c.recipientCount) : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{arDigits(c._count.messages)}</td>
                  <td className="px-4 py-3 text-slate-500">{dateFmt.format(new Date(c.sentAt ?? c.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
