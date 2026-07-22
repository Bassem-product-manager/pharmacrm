"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { arDigits } from "@/lib/format";
import { useAppStore } from "@/lib/store";

/** OWNER-only manual points adjustment (docs/05 §3, R13). Signed points + reason. */
export function PointsAdjustModal({
  customerId,
  balance,
  onClose,
}: {
  customerId: string;
  balance: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useAppStore();
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const points = sign * (Number(amount) || 0);
  const projected = balance + points;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (points === 0) return toast("اكتب عدد نقاط غير صفري", "error");
    if (reason.trim().length < 2) return toast("اكتب سبب التعديل", "error");
    setSaving(true);
    try {
      await api(`/customers/${customerId}/points-adjust`, {
        method: "POST",
        body: JSON.stringify({ points, reason: reason.trim() }),
      });
      toast("تم تعديل الرصيد", "success");
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
    } catch (err) {
      toast(
        err instanceof ApiError && err.code === "POINTS_INSUFFICIENT"
          ? "الرصيد لا يمكن أن يصبح سالبًا"
          : "تعذّر التعديل",
        "error",
      );
      setSaving(false);
    }
  };

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">تعديل رصيد النقاط</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="إغلاق">✕</button>
        </div>
        <p className="mb-4 text-sm text-slate-500">الرصيد الحالي: {arDigits(balance)} نقطة</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setSign(1)} className={`flex-1 rounded-lg py-2 text-sm font-bold ${sign === 1 ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>+ إضافة</button>
            <button type="button" onClick={() => setSign(-1)} className={`flex-1 rounded-lg py-2 text-sm font-bold ${sign === -1 ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"}`}>− خصم</button>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">عدد النقاط</label>
            <input autoFocus type="number" min={1} dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} text-left`} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">السبب</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="تصحيح يدوي، هدية…" className={field} />
          </div>
          <p className={`text-sm ${projected < 0 ? "text-red-600" : "text-slate-500"}`}>
            الرصيد بعد التعديل: {arDigits(projected)} نقطة
          </p>
          <button type="submit" disabled={saving} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "جارٍ الحفظ…" : "تأكيد التعديل"}
          </button>
        </form>
      </div>
    </div>
  );
}
