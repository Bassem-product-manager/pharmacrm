"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { phoneSchema } from "@pharmacrm/shared";
import { api, ApiError } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { countQueuedSales, enqueueSale, type QueuedSalePayload } from "@/lib/offline-queue";
import { useAppStore } from "@/lib/store";

/**
 * S30 — the Quick Sale flow (docs/02 Flow A), now with per-item pricing, notes,
 * a live auto-summed total (editable override), and a product picker that shows
 * the formulary's price / company / stock. Redeem is disabled offline (R11);
 * offline saves go to the IndexedDB queue.
 */

interface CustomerLite {
  id: string;
  name: string;
  phone: string;
  pointsBalance: number;
}

interface SaleResult {
  earnedPoints: number;
  customerName: string;
  idempotentReplay: boolean;
  stockWarnings: { nameText: string; stock: number }[];
}

interface ItemRow {
  key: number;
  nameText: string;
  qty: number;
  productRefId: string | null;
  unitPrice: string;
  notes: string;
  showNotes: boolean;
}

interface Suggestion {
  id: string;
  nameText: string;
  description: string | null;
  company: string | null;
  priceEgp: string | null;
  stock: number;
}

let rowSeq = 1;
const emptyRow = (): ItemRow => ({
  key: rowSeq++,
  nameText: "",
  qty: 1,
  productRefId: null,
  unitPrice: "",
  notes: "",
  showNotes: false,
});

const lineTotal = (r: ItemRow) => (Number(r.unitPrice) || 0) * r.qty;

export function QuickSaleModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { online, toast, setQueuedCount } = useAppStore();

  const [phone, setPhone] = useState("");
  const [selected, setSelected] = useState<CustomerLite | null>(null);
  const [newName, setNewName] = useState("");
  const [consent, setConsent] = useState(true);
  const [items, setItems] = useState<ItemRow[]>([emptyRow()]);
  const [suggestRow, setSuggestRow] = useState<number | null>(null);
  const [totalOverride, setTotalOverride] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [saving, setSaving] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);

  // ---- customer lookup ----
  const digits = phone.replace(/\D/g, "");
  const debouncedDigits = useDebouncedValue(digits);
  const parsedPhone = phoneSchema.safeParse(phone);
  const search = useQuery({
    queryKey: ["customers", "search", debouncedDigits],
    queryFn: () => api<{ data: CustomerLite[] }>(`/customers?search=${debouncedDigits}&limit=5`),
    enabled: online && !selected && debouncedDigits.length >= 4,
  });
  const matches = search.data?.data ?? [];
  const noMatch =
    parsedPhone.success && !selected && search.isSuccess &&
    !matches.some((c) => c.phone === parsedPhone.data);
  const showNewCustomer = parsedPhone.success && !selected && (noMatch || !online);

  // ---- product autocomplete ----
  const activeItem = items.find((i) => i.key === suggestRow);
  const debouncedProductQ = useDebouncedValue(activeItem?.nameText.trim() ?? "");
  const suggest = useQuery({
    queryKey: ["products", "suggest", debouncedProductQ],
    queryFn: () => api<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(debouncedProductQ)}`),
    enabled: online && suggestRow !== null,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setItem = (key: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const pickSuggestion = (key: number, s: Suggestion) => {
    setItem(key, {
      nameText: s.nameText,
      productRefId: s.id,
      unitPrice: s.priceEgp != null ? String(Number(s.priceEgp)) : "",
    });
    setSuggestRow(null);
  };

  const autoSum = items.reduce((s, r) => (r.nameText.trim() ? s + lineTotal(r) : s), 0);
  const effectiveTotal = totalOverride !== "" ? Number(totalOverride) || 0 : autoSum;

  const reset = () => {
    setPhone("");
    setSelected(null);
    setNewName("");
    setConsent(true);
    setItems([emptyRow()]);
    setSuggestRow(null);
    setTotalOverride("");
    setOrderNotes("");
    setRedeemOpen(false);
    setRedeemPoints("");
    phoneRef.current?.focus();
  };

  const queueOffline = async (payload: QueuedSalePayload) => {
    await enqueueSale(payload);
    setQueuedCount(await countQueuedSales());
    toast("سيتم الحفظ عند عودة الإنترنت", "info");
    reset();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const validItems = items.filter((i) => i.nameText.trim().length > 0);
    if (!selected && !parsedPhone.success) return toast("رقم موبايل غير صالح", "error");
    if (!selected && newName.trim().length < 2) return toast("اكتب اسم العميل", "error");
    if (!selected && !consent) return toast("موافقة العميل على الرسائل مطلوبة", "error");
    if (validItems.length === 0) return toast("أضف صنفًا واحدًا على الأقل", "error");
    if (effectiveTotal <= 0) return toast("أدخل سعر الأصناف أو الإجمالي", "error");

    const redeem =
      online && redeemOpen && selected
        ? Math.min(Number(redeemPoints) || 0, selected.pointsBalance)
        : 0;

    const payload: QueuedSalePayload = {
      clientRef: crypto.randomUUID(),
      ...(selected
        ? { customerId: selected.id }
        : { newCustomer: { name: newName.trim(), phone: parsedPhone.success ? parsedPhone.data : phone } }),
      items: validItems.map((i) => ({
        nameText: i.nameText.trim(),
        qty: i.qty,
        unitPriceEgp: Number(i.unitPrice) || 0,
        ...(i.productRefId ? { productRefId: i.productRefId } : {}),
        ...(i.notes.trim() ? { notes: i.notes.trim() } : {}),
      })),
      ...(totalOverride !== "" ? { totalEgp: Number(totalOverride) || 0 } : {}),
      ...(orderNotes.trim() ? { notes: orderNotes.trim() } : {}),
      redeemPoints: redeem,
    };

    if (!navigator.onLine) return void queueOffline(payload);

    setSaving(true);
    try {
      const result = await api<SaleResult>("/sales", { method: "POST", body: JSON.stringify(payload) });
      toast(`+${arDigits(result.earnedPoints)} نقطة ل${result.customerName}`, "success");
      for (const w of result.stockWarnings ?? []) {
        toast(`تنبيه: مخزون ${w.nameText} أصبح ${arDigits(w.stock)}`, "info");
      }
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        toast(err.code === "POINTS_INSUFFICIENT" ? "نقاط غير كافية للاستبدال" : err.message, "error");
      } else {
        await queueOffline(payload);
      }
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-12"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="تسجيل بيع" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">تسجيل بيع</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="إغلاق">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* ---- customer ---- */}
          <div>
            <label htmlFor="qs-phone" className="mb-1 block text-sm font-medium">رقم موبايل العميل</label>
            {selected ? (
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                  {selected.name} · {arDigits(selected.pointsBalance)} نقطة
                </span>
                <button type="button" className="text-xs text-slate-500 underline" onClick={() => { setSelected(null); setRedeemOpen(false); setRedeemPoints(""); }}>
                  تغيير
                </button>
              </div>
            ) : (
              <>
                <input id="qs-phone" ref={phoneRef} autoFocus dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${field} text-left`} />
                {matches.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {matches.map((c) => (
                      <button key={c.id} type="button" onClick={() => setSelected(c)} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-800 hover:bg-emerald-100">
                        {c.name} · {arDigits(c.pointsBalance)} نقطة
                      </button>
                    ))}
                  </div>
                )}
                {showNewCustomer && (
                  <div className="mt-2 space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
                    <p className="text-sm font-medium text-slate-700">عميل جديد؟</p>
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم العميل" className={field} />
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      العميل موافق على استقبال رسائل التذكير والعروض
                    </label>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---- items ---- */}
          <div>
            <label className="mb-1 block text-sm font-medium">الأصناف</label>
            <div className="space-y-3">
              {items.map((row) => (
                <div key={row.key} className="rounded-lg border border-slate-200 p-2">
                  <div className="relative flex gap-2">
                    <div className="relative flex-1">
                      <input
                        value={row.nameText}
                        onChange={(e) => { setItem(row.key, { nameText: e.target.value, productRefId: null }); setSuggestRow(row.key); }}
                        onFocus={() => setSuggestRow(row.key)}
                        onBlur={() => setTimeout(() => setSuggestRow((k) => (k === row.key ? null : k)), 150)}
                        placeholder="اسم الدواء"
                        className={field}
                      />
                      {suggestRow === row.key && (suggest.data?.length ?? 0) > 0 && (
                        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                          {suggest.data!.map((s) => (
                            <li key={s.id}>
                              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(row.key, s)} className="block w-full px-3 py-2 text-right hover:bg-emerald-50">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium text-slate-800">{s.nameText}</span>
                                  <span className="text-xs text-slate-500">{s.priceEgp != null ? egp(Number(s.priceEgp)) : ""}</span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                                  {s.company && <span>{s.company}</span>}
                                  <span className={s.stock <= 5 ? "text-red-500" : ""}>مخزون: {arDigits(s.stock)}</span>
                                </div>
                                {s.description && <div className="mt-0.5 truncate text-xs text-slate-400">{s.description}</div>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <input type="number" min={1} value={row.qty} onChange={(e) => setItem(row.key, { qty: Math.max(1, Number(e.target.value) || 1) })} aria-label="الكمية" className="w-14 rounded-lg border border-slate-300 px-2 py-2 text-center focus:border-emerald-500 focus:outline-none" />
                    <div className="relative w-24">
                      <input type="number" min={0} step="0.01" dir="ltr" value={row.unitPrice} onChange={(e) => setItem(row.key, { unitPrice: e.target.value })} placeholder="السعر" aria-label="سعر الوحدة" className="w-full rounded-lg border border-slate-300 px-2 py-2 text-left focus:border-emerald-500 focus:outline-none" />
                    </div>
                    {items.length > 1 && (
                      <button type="button" onClick={() => setItems((rows) => rows.filter((r) => r.key !== row.key))} className="px-1 text-slate-400 hover:text-red-600" aria-label="حذف الصنف">✕</button>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between px-1">
                    <button type="button" onClick={() => setItem(row.key, { showNotes: !row.showNotes })} className="text-xs text-slate-400 hover:text-emerald-700">
                      {row.showNotes ? "− ملاحظة" : "+ ملاحظة"}
                    </button>
                    {row.nameText.trim() && lineTotal(row) > 0 && (
                      <span className="text-xs text-slate-500">{arDigits(row.qty)} × {egp(Number(row.unitPrice) || 0)} = {egp(lineTotal(row))}</span>
                    )}
                  </div>
                  {row.showNotes && (
                    <input value={row.notes} onChange={(e) => setItem(row.key, { notes: e.target.value })} placeholder="ملاحظة (الجرعة، بديل…)" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none" />
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setItems((rows) => [...rows, emptyRow()])} className="mt-2 text-sm text-emerald-700 hover:underline">+ صنف آخر</button>
          </div>

          {/* ---- order notes ---- */}
          <div>
            <label htmlFor="qs-notes" className="mb-1 block text-sm font-medium">ملاحظات الطلب <span className="text-slate-400">(اختياري)</span></label>
            <input id="qs-notes" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="ملاحظة عامة على الطلب" className={field} />
          </div>

          {/* ---- total (auto-sum + override) + redeem ---- */}
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">إجمالي الأصناف</span>
              <span className="font-bold text-slate-900">{egp(Math.round(autoSum * 100) / 100)}</span>
            </div>
            <div className="mt-2 flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="qs-total" className="mb-1 block text-xs text-slate-500">الإجمالي النهائي (عدّله لو لزم)</label>
                <input id="qs-total" type="number" min={0} step="0.01" dir="ltr" value={totalOverride} onChange={(e) => setTotalOverride(e.target.value)} placeholder={String(Math.round(autoSum * 100) / 100)} className={`${field} text-left`} />
              </div>
              {selected && selected.pointsBalance > 0 && (
                <div className="pb-0.5">
                  <span className="group relative inline-block">
                    <button type="button" disabled={!online} onClick={() => setRedeemOpen((v) => !v)} className={`rounded-full px-3 py-2 text-sm font-medium ${online ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : "cursor-not-allowed bg-slate-100 text-slate-400"}`}>
                      استبدال نقاط
                    </button>
                    {!online && (
                      <span className="pointer-events-none absolute bottom-full left-0 mb-1 hidden whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white group-hover:block">يتطلب اتصال بالإنترنت</span>
                    )}
                  </span>
                </div>
              )}
            </div>
            {redeemOpen && online && selected && (
              <div className="mt-2">
                <label htmlFor="qs-redeem" className="mb-1 block text-xs text-slate-500">نقاط للاستبدال (المتاح {arDigits(selected.pointsBalance)})</label>
                <input id="qs-redeem" type="number" min={0} max={selected.pointsBalance} dir="ltr" value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} className={`${field} text-left`} />
              </div>
            )}
          </div>

          <button type="submit" disabled={saving} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "جارٍ الحفظ…" : `حفظ · ${egp(Math.round(effectiveTotal * 100) / 100)} (Enter)`}
          </button>
        </form>
      </div>
    </div>
  );
}
