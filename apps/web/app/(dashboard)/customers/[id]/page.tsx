"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError, getRole } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { CustomerModal, type Customer } from "@/components/customer-modal";
import { PointsAdjustModal } from "@/components/points-adjust-modal";
import { RefillRuleModal } from "@/components/refill-rule-modal";

interface RefillRule {
  id: string;
  cycleDays: number;
  remindDaysBefore: number;
  autoSend: boolean;
  isActive: boolean;
  nextDueAt: string;
  productRef: { id: string; nameText: string };
}
interface CustomerDetail extends Customer {
  optedOut: boolean;
  refillRules: RefillRule[];
  /** payment-cycle prediction — null until the customer has ≥2 purchases */
  expectedNextVisit: { expectedAt: string; avgIntervalDays: number } | null;
}

interface SaleRow {
  id: string;
  totalEgp: string;
  discountEgp: string;
  notes: string | null;
  createdAt: string;
  items: { id: string; nameText: string; qty: number; unitPriceEgp: string }[];
}
interface MessageRow {
  id: string;
  channel: "WHATSAPP" | "SMS";
  templateName: string | null;
  bodyText: string;
  status: string;
  createdAt: string;
}

const TAG_LABEL: Record<string, string> = { CHRONIC: "مرض مزمن", VIP: "مميّز" };
const GENDER_LABEL: Record<string, string> = { MALE: "ذكر", FEMALE: "أنثى" };
const dateTimeFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" });

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useAppStore();
  const isOwner = getRole() === "OWNER";

  const [tab, setTab] = useState<"sales" | "messages">("sales");
  const [editOpen, setEditOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);

  const customer = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api<CustomerDetail>(`/customers/${id}`),
  });

  const toggleOptOut = useMutation({
    mutationFn: (optedOut: boolean) =>
      api(`/customers/${id}`, { method: "PATCH", body: JSON.stringify({ optedOut }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customer", id] });
      toast("تم تحديث حالة الرسائل", "success");
    },
    onError: () => toast("تعذّر التحديث", "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      toast("تم حذف العميل", "success");
      router.replace("/customers");
    },
    onError: (e) => toast(e instanceof ApiError && e.status === 403 ? "غير مصرّح لك بالحذف" : "تعذّر الحذف", "error"),
  });

  if (customer.isLoading) return <p className="text-slate-400">جارٍ التحميل…</p>;
  if (customer.isError || !customer.data) {
    return (
      <div className="text-center text-slate-500">
        <p className="text-lg">تعذّر العثور على العميل</p>
        <Link href="/customers" className="mt-2 inline-block text-emerald-700 hover:underline">العودة للعملاء</Link>
      </div>
    );
  }
  const c = customer.data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-emerald-700 hover:underline">‹ العملاء</Link>
      </div>

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{c.name}</h1>
            {c.optedOut && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">أوقف الرسائل</span>}
          </div>
          <div className="mt-1 text-slate-500" dir="ltr">{c.phone}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {c.tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{TAG_LABEL[t] ?? t}</span>
            ))}
          </div>
          {c.expectedNextVisit && (
            <div className="mt-2 inline-block rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700">
              🔮 متوقع زيارته {dateFmt.format(new Date(c.expectedNextVisit.expectedAt))} — يشتري كل ~{arDigits(Math.round(c.expectedNextVisit.avgIntervalDays))} يوم
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-xl bg-emerald-50 px-4 py-2 text-center">
            <div className="text-2xl font-bold text-emerald-700">{arDigits(c.pointsBalance)}</div>
            <div className="text-xs text-emerald-600">نقطة ولاء</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditOpen(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">تعديل</button>
            {isOwner && (
              <button type="button" onClick={() => setPointsOpen(true)} className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50">تعديل النقاط</button>
            )}
          </div>
        </div>
      </div>

      {/* info + actions */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm md:col-span-1">
          <h2 className="mb-3 font-bold text-slate-800">المعلومات</h2>
          <dl className="space-y-2 text-sm">
            <Row label="النوع" value={c.gender ? GENDER_LABEL[c.gender] : "—"} />
            <Row label="سنة الميلاد" value={c.birthYear ? arDigits(c.birthYear) : "—"} />
            <Row label="الرسائل" value={c.optedOut ? "موقوفة" : "مفعّلة"} />
            <Row label="الموافقة" value={c.consentAt ? dateFmt.format(new Date(c.consentAt)) : "—"} />
            <Row label="مسجّل منذ" value={dateFmt.format(new Date(c.createdAt))} />
          </dl>
          {c.notes && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{c.notes}</p>}
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => toggleOptOut.mutate(!c.optedOut)}
              disabled={toggleOptOut.isPending}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {c.optedOut ? "إعادة تفعيل الرسائل" : "إيقاف الرسائل"}
            </button>
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`حذف العميل «${c.name}»؟ لا يمكن التراجع.`)) remove.mutate();
                }}
                disabled={remove.isPending}
                className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                حذف العميل
              </button>
            )}
          </div>
        </div>

        {/* refill rules */}
        <div className="rounded-2xl bg-white p-5 shadow-sm md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">تذكيرات إعادة الصرف</h2>
            <button type="button" onClick={() => setRuleOpen(true)} className="text-sm font-medium text-emerald-700 hover:underline">+ إضافة تذكير</button>
          </div>
          {c.refillRules.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">لا توجد تذكيرات بعد</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {c.refillRules.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-slate-800">{r.productRef.nameText}</div>
                    <div className="text-xs text-slate-500">كل {arDigits(r.cycleDays)} يوم · تذكير قبل {arDigits(r.remindDaysBefore)} يوم</div>
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-slate-500">الاستحقاق التالي</div>
                    <div className="text-sm text-slate-700">{dateFmt.format(new Date(r.nextDueAt))}</div>
                    {!r.autoSend && <span className="text-xs text-amber-600">يدوي</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* tabs: sales / messages */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["sales", "messages"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === t ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t === "sales" ? "المشتريات" : "الرسائل"}
            </button>
          ))}
        </div>
        {tab === "sales" ? <SalesTab id={id} /> : <MessagesTab id={id} />}
      </div>

      {editOpen && <CustomerModal existing={c} onClose={() => setEditOpen(false)} />}
      {pointsOpen && <PointsAdjustModal customerId={id} balance={c.pointsBalance} onClose={() => setPointsOpen(false)} />}
      {ruleOpen && <RefillRuleModal customerId={id} onClose={() => setRuleOpen(false)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

function SalesTab({ id }: { id: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<SaleRow[]>([]);
  const q = useQuery({
    queryKey: ["customer", id, "sales", cursor],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const res = await api<{ data: SaleRow[]; nextCursor: string | null }>(`/customers/${id}/sales?${params.toString()}`);
      setRows((prev) => (cursor ? [...prev, ...res.data] : res.data));
      return res;
    },
  });

  if (q.isLoading && rows.length === 0) return <p className="py-6 text-center text-slate-400">جارٍ التحميل…</p>;
  if (rows.length === 0) return <p className="py-6 text-center text-slate-400">لا توجد مشتريات</p>;

  return (
    <div className="space-y-2">
      {rows.map((s) => (
        <div key={s.id} className="rounded-lg border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-800">{egp(Number(s.totalEgp))}</span>
            <span className="flex items-center gap-3">
              <Link href={`/invoice/${s.id}`} className="text-xs text-emerald-700 hover:underline">
                🧾 فاتورة ضريبية
              </Link>
              <span className="text-xs text-slate-400">{dateTimeFmt.format(new Date(s.createdAt))}</span>
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {s.items.map((it) => `${it.nameText} ×${arDigits(it.qty)}`).join("، ")}
          </div>
          {s.notes && <div className="mt-1 text-xs text-slate-400">{s.notes}</div>}
        </div>
      ))}
      {q.data?.nextCursor && (
        <button type="button" onClick={() => setCursor(q.data!.nextCursor)} disabled={q.isFetching} className="w-full rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {q.isFetching ? "جارٍ التحميل…" : "تحميل المزيد"}
        </button>
      )}
    </div>
  );
}

function MessagesTab({ id }: { id: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<MessageRow[]>([]);
  const q = useQuery({
    queryKey: ["customer", id, "messages", cursor],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const res = await api<{ data: MessageRow[]; nextCursor: string | null }>(`/customers/${id}/messages?${params.toString()}`);
      setRows((prev) => (cursor ? [...prev, ...res.data] : res.data));
      return res;
    },
  });

  if (q.isLoading && rows.length === 0) return <p className="py-6 text-center text-slate-400">جارٍ التحميل…</p>;
  if (rows.length === 0) return <p className="py-6 text-center text-slate-400">لا توجد رسائل</p>;

  return (
    <div className="space-y-2">
      {rows.map((m) => (
        <div key={m.id} className="rounded-lg border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{m.channel === "WHATSAPP" ? "واتساب" : "SMS"}</span>
            <span className="text-xs text-slate-400">{dateTimeFmt.format(new Date(m.createdAt))}</span>
          </div>
          <div className="mt-1 text-sm text-slate-700">{m.bodyText}</div>
          <div className="mt-1 text-xs text-slate-400">{m.status}</div>
        </div>
      ))}
      {q.data?.nextCursor && (
        <button type="button" onClick={() => setCursor(q.data!.nextCursor)} disabled={q.isFetching} className="w-full rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {q.isFetching ? "جارٍ التحميل…" : "تحميل المزيد"}
        </button>
      )}
    </div>
  );
}
