"use client";

import { useAppStore } from "@/lib/store";

const TONE_CLASSES: Record<string, string> = {
  success: "bg-emerald-600 text-white",
  info: "bg-amber-500 text-white",
  error: "bg-red-600 text-white",
};

export function Toaster() {
  const { toasts, dismissToast } = useAppStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4" dir="rtl">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className={`rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${TONE_CLASSES[t.tone]}`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
