"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, login } from "@/lib/api";

/**
 * Minimal login (S01 proper comes with the full auth screens). Access token
 * stays in memory; the httpOnly refresh cookie keeps the session across
 * reloads — the dashboard layout silently refreshes on mount.
 */
export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(phone, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "رقم الموبايل أو كلمة المرور غير صحيحة"
          : err instanceof ApiError && err.status === 429
            ? "محاولات كثيرة — انتظر دقيقة ثم حاول مرة أخرى"
            : "تعذر الاتصال بالخادم",
      );
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow">
        <div className="text-center">
          <h1 className="text-2xl font-bold">صيدلي</h1>
          <p className="mt-1 text-sm text-gray-500">تسجيل الدخول</p>
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">رقم الموبايل</label>
          <input
            id="phone"
            dir="ltr"
            inputMode="tel"
            autoFocus
            placeholder="01xxxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-left focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">كلمة المرور</label>
          <input
            id="password"
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-left focus:border-emerald-500 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || !phone || !password}
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "جارٍ الدخول…" : "دخول"}
        </button>
        <p className="text-center text-sm text-gray-500">
          صيدلية جديدة؟{" "}
          <Link href="/signup" className="font-medium text-emerald-600 hover:underline">
            إنشاء حساب
          </Link>
        </p>
      </form>
    </main>
  );
}
