"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getAccessToken, tryRefresh } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { Providers } from "@/components/providers";

interface Invoice {
  invoiceNo: number;
  saleId: string;
  issuedAt: string;
  pharmacy: {
    name: string;
    phone: string;
    city: string | null;
    address: string | null;
    taxId: string | null;
    vatRate: string;
  };
  customer: { id: string; name: string; phone: string };
  items: { nameText: string; qty: number; unitPriceEgp: number; lineTotalEgp: number }[];
  totals: {
    grossEgp: number;
    discountEgp: number;
    netEgp: number;
    vatRate: number;
    vatBaseEgp: number;
    vatAmountEgp: number;
  };
}

const dateFmt = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

function InvoiceBody() {
  const { saleId } = useParams<{ saleId: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice", saleId],
    queryFn: () => api<Invoice>(`/sales/${saleId}/invoice`),
  });

  if (isLoading) return <p className="p-10 text-center text-slate-400">جارٍ تجهيز الفاتورة…</p>;
  if (isError || !data) return <p className="p-10 text-center text-red-600">تعذّر تحميل الفاتورة</p>;

  const inv = data;
  return (
    <div className="mx-auto max-w-2xl p-6 print:p-0">
      {/* screen-only actions */}
      <div className="mb-4 flex justify-between print:hidden">
        <button type="button" onClick={() => window.history.back()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          ‹ رجوع
        </button>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-700">
          🖨 طباعة
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 print:rounded-none print:border-0 print:p-2">
        {/* header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{inv.pharmacy.name}</h1>
            {inv.pharmacy.address && <p className="mt-1 text-sm text-slate-500">{inv.pharmacy.address}</p>}
            <p className="mt-0.5 text-sm text-slate-500" dir="ltr">{inv.pharmacy.phone}</p>
            {inv.pharmacy.taxId && (
              <p className="mt-1 text-sm text-slate-600">رقم البطاقة الضريبية: <span className="font-medium">{inv.pharmacy.taxId}</span></p>
            )}
          </div>
          <div className="text-left">
            <h2 className="text-lg font-bold text-emerald-700">فاتورة ضريبية</h2>
            <p className="mt-1 text-sm text-slate-600">رقم <span className="font-bold">{arDigits(inv.invoiceNo)}</span></p>
            <p className="mt-0.5 text-xs text-slate-400">{dateFmt.format(new Date(inv.issuedAt))}</p>
          </div>
        </div>

        {/* customer */}
        <div className="border-b border-slate-100 py-3 text-sm">
          <span className="text-slate-500">العميل: </span>
          <span className="font-medium text-slate-800">{inv.customer.name}</span>
          <span className="mr-3 text-slate-500" dir="ltr">{inv.customer.phone}</span>
        </div>

        {/* items */}
        <table className="mt-3 w-full text-sm">
          <thead className="text-right text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-2 font-medium">الصنف</th>
              <th className="py-2 font-medium">الكمية</th>
              <th className="py-2 font-medium">سعر الوحدة</th>
              <th className="py-2 font-medium">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inv.items.map((it, i) => (
              <tr key={i}>
                <td className="py-2 text-slate-800">{it.nameText}</td>
                <td className="py-2 text-slate-600">{arDigits(it.qty)}</td>
                <td className="py-2 text-slate-600">{egp(it.unitPriceEgp)}</td>
                <td className="py-2 font-medium text-slate-800">{egp(it.lineTotalEgp)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totals */}
        <div className="mt-4 mr-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">الإجمالي</span><span className="text-slate-800">{egp(inv.totals.grossEgp)}</span></div>
          {inv.totals.discountEgp > 0 && (
            <div className="flex justify-between"><span className="text-slate-500">الخصم</span><span className="text-red-600">− {egp(inv.totals.discountEgp)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-slate-500">الصافي قبل الضريبة</span><span className="text-slate-800">{egp(inv.totals.vatBaseEgp)}</span></div>
          <div className="flex justify-between">
            <span className="text-slate-500">ض.ق.م ({arDigits(inv.totals.vatRate)}٪)</span>
            <span className="text-slate-800">{egp(inv.totals.vatAmountEgp)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
            <span>الإجمالي المستحق</span><span className="text-emerald-700">{egp(inv.totals.netEgp)}</span>
          </div>
        </div>

        <p className="mt-6 border-t border-slate-100 pt-3 text-center text-xs text-slate-400">
          الأسعار شاملة ضريبة القيمة المضافة · شكرًا لتعاملكم مع {inv.pharmacy.name}
        </p>
      </div>
    </div>
  );
}

/** الفاتورة الضريبية — standalone print view (no dashboard shell). */
export default function InvoicePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (getAccessToken() || (await tryRefresh())) setReady(true);
      else router.replace("/login");
    })();
  }, [router]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-400">جارٍ التحميل…</div>;

  return (
    <Providers>
      <InvoiceBody />
    </Providers>
  );
}
