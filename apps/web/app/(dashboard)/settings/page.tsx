"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, getRole } from "@/lib/api";
import { useAppStore } from "@/lib/store";

interface Settings {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
  taxId: string | null;
  vatRate: string; // Decimal serialized
  smsSenderName: string | null;
  smsFallback: boolean;
  quietStart: number;
  quietEnd: number;
  plan: "FREE" | "PRO";
  monthlyReminderCap: number;
}

interface Loyalty {
  loyaltyRatio: string; // Decimal serialized
  redeemRate: string;
}

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400";

/** S60 — settings: pharmacy profile, tax invoice identity, quiet window, loyalty knobs. */
export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useAppStore();
  const isOwner = getRole() === "OWNER";

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const loyalty = useQuery({ queryKey: ["loyalty"], queryFn: () => api<Loyalty>("/loyalty/settings") });

  // profile form
  const [form, setForm] = useState({ name: "", city: "", address: "", taxId: "", vatRate: "", smsSenderName: "", quietStart: "9", quietEnd: "21", smsFallback: true });
  const [loyaltyForm, setLoyaltyForm] = useState({ loyaltyRatio: "", redeemRate: "" });

  useEffect(() => {
    if (settings.data) {
      const s = settings.data;
      setForm({
        name: s.name,
        city: s.city ?? "",
        address: s.address ?? "",
        taxId: s.taxId ?? "",
        vatRate: String(Number(s.vatRate)),
        smsSenderName: s.smsSenderName ?? "",
        quietStart: String(s.quietStart),
        quietEnd: String(s.quietEnd),
        smsFallback: s.smsFallback,
      });
    }
  }, [settings.data]);
  useEffect(() => {
    if (loyalty.data) {
      setLoyaltyForm({
        loyaltyRatio: String(Number(loyalty.data.loyaltyRatio)),
        redeemRate: String(Number(loyalty.data.redeemRate)),
      });
    }
  }, [loyalty.data]);

  const saveSettings = useMutation({
    mutationFn: () =>
      api("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name.trim(),
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          taxId: form.taxId.trim() || null,
          vatRate: Number(form.vatRate) || 0,
          smsSenderName: form.smsSenderName.trim() || null,
          quietStart: Number(form.quietStart),
          quietEnd: Number(form.quietEnd),
          smsFallback: form.smsFallback,
        }),
      }),
    onSuccess: () => {
      toast("تم حفظ الإعدادات", "success");
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast("تعذّر الحفظ", "error"),
  });

  const saveLoyalty = useMutation({
    mutationFn: () =>
      api("/loyalty/settings", {
        method: "PATCH",
        body: JSON.stringify({
          loyaltyRatio: Number(loyaltyForm.loyaltyRatio) || 0,
          redeemRate: Number(loyaltyForm.redeemRate) || 0,
        }),
      }),
    onSuccess: () => {
      toast("تم حفظ إعدادات النقاط", "success");
      void qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
    onError: () => toast("تعذّر الحفظ", "error"),
  });

  if (settings.isLoading) return <p className="text-slate-400">جارٍ التحميل…</p>;
  if (settings.isError || !settings.data) return <p className="text-red-600">تعذّر تحميل الإعدادات</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">الإعدادات</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${settings.data.plan === "PRO" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          باقة {settings.data.plan === "PRO" ? "PRO احترافية" : "مجانية"}
        </span>
      </div>
      {!isOwner && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">وضع القراءة فقط — التعديل لصاحب الصيدلية</p>
      )}

      {/* pharmacy + tax identity */}
      <form
        className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
        onSubmit={(e) => { e.preventDefault(); saveSettings.mutate(); }}
      >
        <h2 className="font-bold text-slate-900">بيانات الصيدلية والفاتورة الضريبية</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">اسم الصيدلية</label>
            <input disabled={!isOwner} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">المدينة</label>
            <input disabled={!isOwner} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={field} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">العنوان <span className="text-slate-400">(يُطبع على الفاتورة)</span></label>
          <input disabled={!isOwner} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">رقم البطاقة الضريبية</label>
            <input disabled={!isOwner} value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">نسبة الضريبة ٪ <span className="text-slate-400">(الأسعار شاملة)</span></label>
            <input disabled={!isOwner} type="number" min={0} max={100} step="0.01" dir="ltr" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} className={`${field} text-left`} />
          </div>
        </div>
        <h3 className="pt-2 font-medium text-slate-700">الرسائل</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">بداية نافذة الإرسال</label>
            <input disabled={!isOwner} type="number" min={0} max={23} dir="ltr" value={form.quietStart} onChange={(e) => setForm({ ...form, quietStart: e.target.value })} className={`${field} text-left`} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">نهاية نافذة الإرسال</label>
            <input disabled={!isOwner} type="number" min={0} max={23} dir="ltr" value={form.quietEnd} onChange={(e) => setForm({ ...form, quietEnd: e.target.value })} className={`${field} text-left`} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">اسم مرسل SMS</label>
            <input disabled={!isOwner} dir="ltr" maxLength={11} value={form.smsSenderName} onChange={(e) => setForm({ ...form, smsSenderName: e.target.value })} className={`${field} text-left`} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input disabled={!isOwner} type="checkbox" checked={form.smsFallback} onChange={(e) => setForm({ ...form, smsFallback: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            تفعيل بديل SMS عند تعذّر واتساب
          </label>
        </div>
        {isOwner && (
          <button type="submit" disabled={saveSettings.isPending} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saveSettings.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
          </button>
        )}
      </form>

      {/* loyalty */}
      <form
        className="space-y-4 rounded-2xl bg-white p-6 shadow-sm"
        onSubmit={(e) => { e.preventDefault(); saveLoyalty.mutate(); }}
      >
        <h2 className="font-bold text-slate-900">نظام النقاط</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">نقاط لكل ١ ج.م</label>
            <input disabled={!isOwner} type="number" min={0} max={10} step="0.01" dir="ltr" value={loyaltyForm.loyaltyRatio} onChange={(e) => setLoyaltyForm({ ...loyaltyForm, loyaltyRatio: e.target.value })} className={`${field} text-left`} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">قيمة النقطة (ج.م)</label>
            <input disabled={!isOwner} type="number" min={0} max={100} step="0.01" dir="ltr" value={loyaltyForm.redeemRate} onChange={(e) => setLoyaltyForm({ ...loyaltyForm, redeemRate: e.target.value })} className={`${field} text-left`} />
          </div>
        </div>
        <p className="text-xs text-slate-400">
          مثال: بمعدل كسب ٠٫١ وقيمة ٠٫٢٥ ج.م — عميل يشتري بـ ٢٠٠ ج.م يكسب ٢٠ نقطة تساوي ٥ ج.م خصم.
        </p>
        {isOwner && (
          <button type="submit" disabled={saveLoyalty.isPending} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saveLoyalty.isPending ? "جارٍ الحفظ…" : "حفظ إعدادات النقاط"}
          </button>
        )}
      </form>
    </div>
  );
}
