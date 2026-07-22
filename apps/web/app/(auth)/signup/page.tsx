"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, signup } from "@/lib/api";

/** Pharmacy signup (S02): creates the Pharmacy + OWNER user and signs in. */
export default function SignupPage() {
  const router = useRouter();
  const [pharmacyName, setPharmacyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("كلمة المرور يجب ألا تقل عن ٨ أحرف");
      return;
    }
    setLoading(true);
    try {
      await signup({
        pharmacyName,
        ownerName,
        phone,
        password,
        ...(city.trim() ? { city: city.trim() } : {}),
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "AUTH_PHONE_TAKEN"
          ? "هذا الرقم مسجل بالفعل — جرّب تسجيل الدخول"
          : err instanceof ApiError && err.status === 400
            ? "تأكد من صحة البيانات (رقم موبايل مصري وكلمة مرور ٨ أحرف على الأقل)"
            : "تعذر الاتصال بالخادم",
      );
      setLoading(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow">
        <div className="text-center">
          <h1 className="text-2xl font-bold">صيدلي</h1>
          <p className="mt-1 text-sm text-gray-500">إنشاء حساب صيدلية جديدة</p>
        </div>
        <div>
          <label htmlFor="pharmacyName" className="mb-1 block text-sm font-medium">اسم الصيدلية</label>
          <input
            id="pharmacyName"
            autoFocus
            placeholder="صيدلية النور"
            value={pharmacyName}
            onChange={(e) => setPharmacyName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="ownerName" className="mb-1 block text-sm font-medium">اسم المالك</label>
          <input
            id="ownerName"
            placeholder="د. أحمد محمد"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">رقم الموبايل</label>
          <input
            id="phone"
            dir="ltr"
            inputMode="tel"
            placeholder="01xxxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${inputCls} text-left`}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">كلمة المرور</label>
          <input
            id="password"
            type="password"
            dir="ltr"
            placeholder="٨ أحرف على الأقل"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputCls} text-left`}
          />
        </div>
        <div>
          <label htmlFor="city" className="mb-1 block text-sm font-medium">
            المدينة <span className="text-gray-400">(اختياري)</span>
          </label>
          <input
            id="city"
            placeholder="القاهرة"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputCls}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || !pharmacyName || !ownerName || !phone || !password}
          className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
        </button>
        <p className="text-center text-sm text-gray-500">
          لديك حساب بالفعل؟{" "}
          <Link href="/login" className="font-medium text-emerald-600 hover:underline">
            تسجيل الدخول
          </Link>
        </p>
      </form>
    </main>
  );
}
