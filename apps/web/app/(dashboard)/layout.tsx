"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAccessToken, logout, tryRefresh } from "@/lib/api";
import { OfflineBanner } from "@/components/offline-banner";
import { Providers } from "@/components/providers";
import { QuickSaleLauncher } from "@/components/quick-sale-launcher";
import { Toaster } from "@/components/toaster";

/**
 * Dashboard shell (docs/02 §3): RTL, fixed right sidebar 240px, content max
 * 1280px, Quick Sale reachable from EVERY screen (FAB + F2). Auth gate:
 * in-memory token or a silent refresh via the httpOnly cookie, else /login.
 */
const NAV = [
  { href: "/dashboard", label: "الرئيسية", active: true },
  { href: "/catalog", label: "دليل الأدوية", active: true },
  { href: "/customers", label: "العملاء", active: true },
  { href: "/refills", label: "التذكيرات", active: true },
  { href: "/campaigns", label: "الحملات", active: true },
  { href: "/settings", label: "الإعدادات", active: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (getAccessToken() || (await tryRefresh())) setReady(true);
      else router.replace("/login");
    })();
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">جارٍ التحميل…</div>
    );
  }

  return (
    <Providers>
      <div className="min-h-screen bg-gray-50">
        <OfflineBanner />
        <aside className="fixed inset-y-0 right-0 z-30 flex w-60 flex-col border-l border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <span className="text-xl font-bold text-emerald-700">صيدلي</span>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {NAV.map((item) =>
              item.active ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  className="block cursor-default rounded-lg px-3 py-2 text-gray-400"
                >
                  {item.label} <span className="text-xs">(قريبًا)</span>
                </span>
              ),
            )}
          </nav>
          <div className="border-t border-gray-100 p-3">
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
              className="w-full rounded-lg px-3 py-2 text-right text-sm text-gray-500 hover:bg-gray-50"
            >
              تسجيل الخروج
            </button>
          </div>
        </aside>
        <main className="mr-60">
          <div className="mx-auto max-w-[1280px] p-6">{children}</div>
        </main>
        <QuickSaleLauncher />
        <Toaster />
      </div>
    </Providers>
  );
}
