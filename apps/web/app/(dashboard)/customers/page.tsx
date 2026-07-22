"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, downloadCsv } from "@/lib/api";
import { arDigits } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { useAppStore } from "@/lib/store";
import { CustomerModal, type Customer } from "@/components/customer-modal";

interface CustomerList {
  data: Customer[];
  nextCursor: string | null;
}

const TAG_LABEL: Record<string, string> = { CHRONIC: "مرض مزمن", VIP: "مميّز" };
const TAG_FILTERS: { value: "CHRONIC" | "VIP"; label: string }[] = [
  { value: "CHRONIC", label: "مرض مزمن" },
  { value: "VIP", label: "مميّز" },
];
const INACTIVE_FILTERS = [
  { value: 0, label: "الكل" },
  { value: 30, label: "غائب ٣٠ يوم" },
  { value: 60, label: "غائب ٦٠ يوم" },
  { value: 90, label: "غائب ٩٠ يوم" },
];

const dateFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" });

/** العملاء — customer list with search/tag/inactive filters + cursor pagination (S4 API). */
export default function CustomersPage() {
  const router = useRouter();
  const { toast } = useAppStore();
  const [downloading, setDownloading] = useState(false);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<"CHRONIC" | "VIP" | null>(null);
  const [inactiveDays, setInactiveDays] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<Customer[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim());

  const buildKey = (c: string | null) => ["customers", "list", debouncedSearch, tag, inactiveDays, c] as const;

  const list = useQuery({
    queryKey: buildKey(cursor),
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "25" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (tag) params.set("tag", tag);
      if (inactiveDays) params.set("inactiveDays", String(inactiveDays));
      if (cursor) params.set("cursor", cursor);
      const res = await api<CustomerList>(`/customers?${params.toString()}`);
      setRows((prev) => (cursor ? [...prev, ...res.data] : res.data));
      return res;
    },
  });

  // Reset accumulated rows whenever a filter changes (cursor back to null).
  const resetAnd = (fn: () => void) => {
    setCursor(null);
    setRows([]);
    fn();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">العملاء</h1>
          <p className="mt-1 text-sm text-slate-500">ابحث، صنّف، وتابع نقاط وولاء عملائك.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await downloadCsv("/reports/customers.csv", "customers.csv");
                toast("تم تنزيل ملف العملاء", "success");
              } catch {
                toast("تعذّر التنزيل", "error");
              } finally {
                setDownloading(false);
              }
            }}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {downloading ? "جارٍ التنزيل…" : "⬇ تصدير CSV"}
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            + إضافة عميل
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => resetAnd(() => setSearch(e.target.value))}
          placeholder="ابحث بالاسم أو رقم الموبايل…"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => resetAnd(() => setTag(null))}
            className={`rounded-full px-3 py-1 text-sm ${tag === null ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            كل الوسوم
          </button>
          {TAG_FILTERS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => resetAnd(() => setTag(t.value))}
              className={`rounded-full px-3 py-1 text-sm ${tag === t.value ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={inactiveDays}
          onChange={(e) => resetAnd(() => setInactiveDays(Number(e.target.value)))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        >
          {INACTIVE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {list.isLoading && rows.length === 0 ? (
          <p className="p-6 text-slate-400">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <p className="text-lg">لا يوجد عملاء مطابقون</p>
            <p className="mt-1 text-sm">اضغط «إضافة عميل» لتسجيل أول عميل</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">العميل</th>
                <th className="px-4 py-3 font-medium">الوسوم</th>
                <th className="px-4 py-3 font-medium">النقاط</th>
                <th className="px-4 py-3 font-medium">آخر زيارة</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-400" dir="ltr">{c.phone}</div>
                    {c.optedOutAt && (
                      <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">أوقف الرسائل</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.length === 0 ? <span className="text-slate-300">—</span> : c.tags.map((t) => (
                        <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{TAG_LABEL[t] ?? t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-emerald-700">{arDigits(c.pointsBalance)}</td>
                  <td className="px-4 py-3 text-slate-600">{c.lastVisitAt ? dateFmt.format(new Date(c.lastVisitAt)) : "—"}</td>
                  <td className="px-4 py-3 text-left text-emerald-700">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.data?.nextCursor && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setCursor(list.data!.nextCursor)}
            disabled={list.isFetching}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {list.isFetching ? "جارٍ التحميل…" : "تحميل المزيد"}
          </button>
        </div>
      )}

      {modalOpen && (
        <CustomerModal
          existing={null}
          onClose={(created) => {
            setModalOpen(false);
            if (created) router.push(`/customers/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
