"use client";

import { useEffect, useState } from "react";
import { QuickSaleModal } from "./quick-sale-modal";

/** Global Quick Sale entry: FAB on every dashboard screen + F2 anywhere (docs/02 §3). */
export function QuickSaleLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="تسجيل بيع (F2)"
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-bold text-white shadow-lg hover:bg-emerald-700"
      >
        <span className="text-xl leading-none">+</span>
        تسجيل بيع
      </button>
      {open && <QuickSaleModal onClose={() => setOpen(false)} />}
    </>
  );
}
