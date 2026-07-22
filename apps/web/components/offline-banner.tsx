"use client";

import { arDigits } from "@/lib/format";
import { useAppStore } from "@/lib/store";

export function OfflineBanner() {
  const { online, queuedCount } = useAppStore();
  if (online && queuedCount === 0) return null;
  return (
    <div
      className={`sticky top-0 z-50 px-4 py-2 text-center text-sm font-medium ${
        online ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"
      }`}
    >
      {online
        ? `جارٍ مزامنة ${arDigits(queuedCount)} عملية بيع…`
        : `أنت غير متصل بالإنترنت — سيتم حفظ المبيعات محليًا${
            queuedCount > 0 ? ` (${arDigits(queuedCount)} بانتظار المزامنة)` : ""
          }`}
    </div>
  );
}
