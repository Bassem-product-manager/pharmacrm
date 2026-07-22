"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { arDigits } from "@/lib/format";
import { countQueuedSales, flushSaleQueue, type QueuedSalePayload } from "@/lib/offline-queue";
import { useAppStore } from "@/lib/store";

/** Adapter for flushSaleQueue: ApiError → status (queue decides retry/drop); network errors rethrow. */
async function postQueuedSale(payload: QueuedSalePayload): Promise<{ ok: boolean; status: number }> {
  try {
    await api("/sales", { method: "POST", body: JSON.stringify(payload) });
    return { ok: true, status: 200 };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, status: e.status };
    throw e;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
      }),
  );
  const { setOnline, setQueuedCount, toast } = useAppStore();

  useEffect(() => {
    const flush = async () => {
      const { synced } = await flushSaleQueue(postQueuedSale);
      setQueuedCount(await countQueuedSales());
      if (synced > 0) {
        toast(`تمت مزامنة ${arDigits(synced)} عملية بيع`, "success");
        void queryClient.invalidateQueries();
      }
    };
    setOnline(navigator.onLine);
    void countQueuedSales().then(setQueuedCount);
    if (navigator.onLine) void flush();

    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [queryClient, setOnline, setQueuedCount, toast]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
