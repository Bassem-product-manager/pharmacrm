"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export interface Medicine {
  id: string;
  nameText: string;
  description: string | null;
  company: string | null;
  category: string | null;
  priceEgp: string | null; // Decimal serialized
  stock: number;
}

/** Add / edit a formulary medicine (دليل الأدوية). */
export function MedicineModal({
  existing,
  onClose,
}: {
  existing: Medicine | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useAppStore();
  const [nameText, setNameText] = useState(existing?.nameText ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [priceEgp, setPriceEgp] = useState(existing?.priceEgp ?? "");
  const [stock, setStock] = useState(String(existing?.stock ?? 0));
  const [description, setDescription] = useState(existing?.description ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameText.trim().length < 1) return toast("اكتب اسم الدواء", "error");
    setSaving(true);
    const payload = {
      nameText: nameText.trim(),
      company: company.trim() || null,
      category: category.trim() || null,
      priceEgp: priceEgp === "" ? null : Number(priceEgp),
      stock: Number(stock) || 0,
      description: description.trim() || null,
    };
    try {
      if (existing) {
        await api(`/products/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast("تم تحديث الدواء", "success");
      } else {
        await api("/products", { method: "POST", body: JSON.stringify(payload) });
        toast("تمت إضافة الدواء", "success");
      }
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    } catch (err) {
      toast(
        err instanceof ApiError && err.code === "VALIDATION_FAILED"
          ? "هذا الاسم موجود بالفعل"
          : "تعذر الحفظ",
        "error",
      );
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
          <h2 className="text-lg font-bold">{existing ? "تعديل دواء" : "إضافة دواء جديد"}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="إغلاق">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">اسم الدواء</label>
            <input autoFocus value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="كونكور ٥ مجم" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">الشركة المصنّعة</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ميرك" className={field} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">التصنيف</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="أدوية الضغط" className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">السعر (ج.م)</label>
              <input type="number" min={0} step="0.01" dir="ltr" value={priceEgp} onChange={(e) => setPriceEgp(e.target.value)} className={`${field} text-left`} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">الكمية بالمخزون</label>
              <input type="number" min={0} dir="ltr" value={stock} onChange={(e) => setStock(e.target.value)} className={`${field} text-left`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الوصف <span className="text-slate-400">(يظهر عند البيع)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="دواعي الاستعمال، الجرعة…" className={`${field} resize-none`} />
          </div>
          <button type="submit" disabled={saving} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "جارٍ الحفظ…" : existing ? "حفظ التعديلات" : "إضافة الدواء"}
          </button>
        </form>
      </div>
    </div>
  );
}
