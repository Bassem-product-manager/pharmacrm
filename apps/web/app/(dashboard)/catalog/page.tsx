"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { MedicineModal, type Medicine } from "@/components/medicine-modal";

const LOW_STOCK = 5;

interface ProductList {
  data: Medicine[];
  nextCursor: string | null;
}

/** دليل الأدوية — the pharmacy's medicine formulary (S7). */
export default function CatalogPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; edit: Medicine | null }>({ open: false, edit: null });
  const debouncedSearch = useDebouncedValue(search.trim());

  const categories = useQuery({
    queryKey: ["products", "categories"],
    queryFn: () => api<string[]>("/products/categories"),
  });

  const products = useQuery({
    queryKey: ["products", "list", debouncedSearch, category],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (category) params.set("category", category);
      return api<ProductList>(`/products?${params.toString()}`);
    },
  });

  const rows = products.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">دليل الأدوية</h1>
          <p className="mt-1 text-sm text-slate-500">كل الأدوية المتوفرة في صيدليتك — السعر، الشركة، والمخزون.</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ open: true, edit: null })}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm hover:bg-emerald-700"
        >
          + إضافة دواء
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الشركة…"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none"
        />
        {(categories.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={`rounded-full px-3 py-1 text-sm ${category === null ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              الكل
            </button>
            {categories.data!.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-sm ${category === c ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {products.isLoading ? (
          <p className="p-6 text-slate-400">جارٍ التحميل…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <p className="text-lg">لا توجد أدوية بعد</p>
            <p className="mt-1 text-sm">اضغط «إضافة دواء» لبناء دليل صيدليتك</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">الدواء</th>
                <th className="px-4 py-3 font-medium">التصنيف</th>
                <th className="px-4 py-3 font-medium">الشركة</th>
                <th className="px-4 py-3 font-medium">السعر</th>
                <th className="px-4 py-3 font-medium">المخزون</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{p.nameText}</div>
                    {p.description && <div className="mt-0.5 max-w-md truncate text-xs text-slate-400">{p.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.category ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{p.category}</span> : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.company ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">{p.priceEgp != null ? egp(Number(p.priceEgp)) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.stock <= LOW_STOCK ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
                      {arDigits(p.stock)}
                      {p.stock <= LOW_STOCK && " ⚠"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-left">
                    <button type="button" onClick={() => setModal({ open: true, edit: p })} className="text-sm text-emerald-700 hover:underline">
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal.open && <MedicineModal existing={modal.edit} onClose={() => setModal({ open: false, edit: null })} />}
    </div>
  );
}
