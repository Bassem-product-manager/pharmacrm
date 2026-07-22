"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

/**
 * S41 — refills queue (docs/02): 3 buckets متأخر/اليوم/٧ أيام, inline actions
 * [أرسل الآن][تم الشراء][تأجيل], FAILED rows in danger red with tel: link.
 */

type Bucket = "overdue" | "today" | "week";

interface QueueRow {
  id: string;
  dueAt: string;
  status: "PENDING" | "SENT" | "CONVERTED" | "FAILED" | "SNOOZED" | "CANCELLED";
  customer: { id: string; name: string; phone: string; optedOutAt: string | null };
  product: { id: string; nameText: string };
  cycleDays: number;
  lastMessage: { channel: "WHATSAPP" | "SMS"; status: string } | null;
}

const TABS: { key: Bucket; label: string }[] = [
  { key: "overdue", label: "متأخر" },
  { key: "today", label: "اليوم" },
  { key: "week", label: "٧ أيام" },
];

const STATUS_LABEL: Record<QueueRow["status"], string> = {
  PENDING: "قيد الانتظار",
  SENT: "تم الإرسال",
  CONVERTED: "تم الشراء",
  FAILED: "فشل الإرسال",
  SNOOZED: "مؤجّل",
  CANCELLED: "ملغي",
};

const dateFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long" });

export default function RefillsPage() {
  const [bucket, setBucket] = useState<Bucket>("today");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["refills-queue", bucket],
    queryFn: () => api<{ data: QueueRow[] }>(`/refills/queue?bucket=${bucket}`),
    refetchInterval: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["refills-queue"] });

  const sendNow = useMutation({
    mutationFn: (id: string) => api(`/reminders/${id}/send-now`, { method: "POST" }),
    onSettled: invalidate,
  });
  const markPurchased = useMutation({
    mutationFn: (id: string) => api(`/reminders/${id}/mark-purchased`, { method: "POST" }),
    onSettled: invalidate,
  });
  const snooze = useMutation({
    mutationFn: (id: string) =>
      api(`/reminders/${id}/snooze`, { method: "POST", body: JSON.stringify({ days: 3 }) }),
    onSettled: invalidate,
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">تذكيرات إعادة الصرف</h1>
      </div>

      {/* tabs */}
      <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setBucket(t.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
              bucket === t.key ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <div className="p-10 text-center text-gray-400">جارٍ التحميل…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            لا توجد تذكيرات في هذه القائمة 🎉
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-right text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">العميل</th>
                <th className="px-4 py-3 font-medium">الدواء</th>
                <th className="px-4 py-3 font-medium">الاستحقاق</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const failed = r.status === "FAILED";
                const closed = r.status === "CONVERTED" || r.status === "CANCELLED";
                return (
                  <tr key={r.id} className={failed ? "bg-red-50" : undefined}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.customer.name}</div>
                      <div className="text-xs text-gray-500" dir="ltr">
                        {r.customer.phone}
                      </div>
                      {r.customer.optedOutAt && (
                        <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          أوقف الرسائل
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.product.nameText}
                      <div className="text-xs text-gray-400">كل {r.cycleDays} يوم</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{dateFmt.format(new Date(r.dueAt))}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          failed
                            ? "bg-red-100 text-red-700"
                            : r.status === "CONVERTED"
                              ? "bg-emerald-100 text-emerald-700"
                              : r.status === "SENT"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.lastMessage && (
                        <div className="mt-1 text-xs text-gray-400">
                          {r.lastMessage.channel === "WHATSAPP" ? "واتساب" : "SMS"} · {r.lastMessage.status}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {failed ? (
                        // both channels failed → call the customer (S41 red row)
                        <a
                          href={`tel:${r.customer.phone}`}
                          className="inline-block rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                        >
                          اتصل بالعميل
                        </a>
                      ) : closed ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={sendNow.isPending || !!r.customer.optedOutAt || r.status === "SENT"}
                            onClick={() => sendNow.mutate(r.id)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            أرسل الآن
                          </button>
                          <button
                            type="button"
                            disabled={markPurchased.isPending}
                            onClick={() => markPurchased.mutate(r.id)}
                            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            تم الشراء
                          </button>
                          <button
                            type="button"
                            disabled={snooze.isPending}
                            onClick={() => snooze.mutate(r.id)}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          >
                            تأجيل ٣ أيام
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
