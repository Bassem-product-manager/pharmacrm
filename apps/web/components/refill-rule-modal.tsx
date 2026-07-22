"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { egp } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { useAppStore } from "@/lib/store";

interface Suggestion {
  id: string;
  nameText: string;
  company: string | null;
  priceEgp: string | null;
  stock: number;
}

/**
 * Add a refill rule to a customer (R9 — exact ProductRef, never fuzzy text).
 * Product is chosen from the formulary via /products/suggest, so productRefId
 * is always a real id. Hits POST /customers/:id/refill-rules.
 */
export function RefillRuleModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useAppStore();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const [cycleDays, setCycleDays] = useState("30");
  const [remindDaysBefore, setRemindDaysBefore] = useState("2");
  const [autoSend, setAutoSend] = useState(true);
  const [saving, setSaving] = useState(false);
  const debouncedQuery = useDebouncedValue(query.trim());

  const suggest = useQuery({
    queryKey: ["products", "suggest", debouncedQuery],
    queryFn: () => api<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: showSuggest && debouncedQuery.length > 0,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return toast("اختر الدواء من دليل الأدوية", "error");
    const cycle = Number(cycleDays);
    if (!Number.isInteger(cycle) || cycle < 1 || cycle > 365) return toast("مدة الدورة بين ١ و ٣٦٥ يوم", "error");
    setSaving(true);
    try {
      await api(`/customers/${customerId}/refill-rules`, {
        method: "POST",
        body: JSON.stringify({
          productRefId: picked.id,
          cycleDays: cycle,
          remindDaysBefore: Number(remindDaysBefore) || 0,
          autoSend,
        }),
      });
      toast("تمت إضافة قاعدة التذكير", "success");
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? "تعذّرت الإضافة" : "تعذّرت الإضافة", "error");
      setSaving(false);
    }
  };

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">تذكير إعادة صرف جديد</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="إغلاق">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <label className="mb-1 block text-sm font-medium">الدواء</label>
            {picked ? (
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div>
                  <div className="font-medium text-slate-800">{picked.nameText}</div>
                  {picked.company && <div className="text-xs text-slate-500">{picked.company}</div>}
                </div>
                <button type="button" onClick={() => { setPicked(null); setQuery(""); }} className="text-sm text-emerald-700 hover:underline">تغيير</button>
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); }}
                  placeholder="ابحث في دليل الأدوية…"
                  className={field}
                />
                {showSuggest && debouncedQuery.length > 0 && (suggest.data?.length ?? 0) > 0 && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {suggest.data!.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setPicked(s); setShowSuggest(false); }}
                        className="flex w-full items-center justify-between px-3 py-2 text-right hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium text-slate-800">{s.nameText}</span>
                        <span className="text-xs text-slate-500">{s.priceEgp != null ? egp(Number(s.priceEgp)) : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showSuggest && debouncedQuery.length > 0 && !suggest.isLoading && (suggest.data?.length ?? 0) === 0 && (
                  <p className="mt-1 text-xs text-slate-400">لا يوجد دواء بهذا الاسم — أضِفه أولًا من دليل الأدوية.</p>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">مدة الدورة (يوم)</label>
              <input type="number" min={1} max={365} dir="ltr" value={cycleDays} onChange={(e) => setCycleDays(e.target.value)} className={`${field} text-left`} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">تذكير قبل (يوم)</label>
              <input type="number" min={0} max={30} dir="ltr" value={remindDaysBefore} onChange={(e) => setRemindDaysBefore(e.target.value)} className={`${field} text-left`} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            إرسال التذكير تلقائيًا عند الاستحقاق
          </label>
          <button type="submit" disabled={saving} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "جارٍ الحفظ…" : "إضافة التذكير"}
          </button>
        </form>
      </div>
    </div>
  );
}
