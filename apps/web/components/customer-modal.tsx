"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  gender: "MALE" | "FEMALE" | null;
  birthYear: number | null;
  tags: ("CHRONIC" | "VIP")[];
  notes: string | null;
  consentAt: string | null;
  optedOutAt: string | null;
  pointsBalance: number;
  lastVisitAt: string | null;
  createdAt: string;
}

const ALL_TAGS: { value: "CHRONIC" | "VIP"; label: string }[] = [
  { value: "CHRONIC", label: "مرض مزمن" },
  { value: "VIP", label: "مميّز" },
];

/** Add / edit a customer (العملاء). Phone is immutable-friendly but editable. */
export function CustomerModal({
  existing,
  onClose,
}: {
  existing: Customer | null;
  onClose: (created?: Customer) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useAppStore();
  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [gender, setGender] = useState<"" | "MALE" | "FEMALE">(existing?.gender ?? "");
  const [birthYear, setBirthYear] = useState(existing?.birthYear ? String(existing.birthYear) : "");
  const [tags, setTags] = useState<("CHRONIC" | "VIP")[]>(existing?.tags ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const toggleTag = (t: "CHRONIC" | "VIP") =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return toast("اكتب اسم العميل", "error");
    if (phone.trim().length < 6) return toast("اكتب رقم موبايل صحيح", "error");
    setSaving(true);
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      gender: gender === "" ? null : gender,
      birthYear: birthYear === "" ? null : Number(birthYear),
      tags,
      notes: notes.trim() || null,
    };
    try {
      if (existing) {
        await api(`/customers/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast("تم تحديث بيانات العميل", "success");
        void queryClient.invalidateQueries({ queryKey: ["customer", existing.id] });
        void queryClient.invalidateQueries({ queryKey: ["customers"] });
        onClose();
      } else {
        const created = await api<Customer>("/customers", { method: "POST", body: JSON.stringify(payload) });
        toast("تمت إضافة العميل", "success");
        void queryClient.invalidateQueries({ queryKey: ["customers"] });
        onClose(created);
      }
    } catch (err) {
      toast(
        err instanceof ApiError && err.code === "VALIDATION_FAILED"
          ? "هذا الرقم مسجّل بالفعل"
          : "تعذّر الحفظ",
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
          <h2 className="text-lg font-bold">{existing ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</h2>
          <button type="button" onClick={() => onClose()} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="إغلاق">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">الاسم</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="محمد أحمد" className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">رقم الموبايل</label>
            <input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01001234567" className={`${field} text-left`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">النوع</label>
              <select value={gender} onChange={(e) => setGender(e.target.value as "" | "MALE" | "FEMALE")} className={field}>
                <option value="">—</option>
                <option value="MALE">ذكر</option>
                <option value="FEMALE">أنثى</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">سنة الميلاد</label>
              <input type="number" min={1900} max={2030} dir="ltr" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="1985" className={`${field} text-left`} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الوسوم</label>
            <div className="flex gap-2">
              {ALL_TAGS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => toggleTag(t.value)}
                  className={`rounded-full px-3 py-1 text-sm ${tags.includes(t.value) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">ملاحظات</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="حساسية، تفضيلات…" className={`${field} resize-none`} />
          </div>
          <button type="submit" disabled={saving} className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "جارٍ الحفظ…" : existing ? "حفظ التعديلات" : "إضافة العميل"}
          </button>
        </form>
      </div>
    </div>
  );
}
