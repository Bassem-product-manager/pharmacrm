"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { arDigits, egp } from "@/lib/format";
import { useAppStore } from "@/lib/store";

interface Template {
  name: string;
  titleAr: string;
  bodyAr: string;
  params: readonly string[];
}

type Tag = "CHRONIC" | "VIP";

/**
 * S52 — 3-step campaign wizard. Step 3 is a HARD STOP: the Send button stays
 * disabled until the live segment preview (count + cost) has loaded, so the
 * owner always sees exactly how many messages and how many pounds before
 * anything fires. FREE plan → upgrade banner (403 PLAN_UPGRADE_REQUIRED).
 */
export default function NewCampaignPage() {
  const router = useRouter();
  const { toast } = useAppStore();
  const [step, setStep] = useState(1);

  // step 1 — name + segment
  const [name, setName] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [inactiveDays, setInactiveDays] = useState("");
  const [minPoints, setMinPoints] = useState("");

  // step 2 — template
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [smsText, setSmsText] = useState("");

  const [planBlocked, setPlanBlocked] = useState(false);

  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<Template[]>("/templates"),
  });

  const segment = {
    ...(tags.length > 0 ? { tags } : {}),
    ...(inactiveDays ? { inactiveDays: Number(inactiveDays) } : {}),
    ...(minPoints ? { minPoints: Number(minPoints) } : {}),
  };

  // step 3 — the hard stop: live recipients + cost
  const preview = useQuery({
    queryKey: ["campaigns", "preview", JSON.stringify(segment)],
    queryFn: () =>
      api<{ recipients: number; estCostEgp: number }>("/campaigns/preview-segment", {
        method: "POST",
        body: JSON.stringify({ segment }),
      }),
    enabled: step === 3,
  });

  const selectedTemplate = templates.data?.find((t) => t.name === templateName) ?? null;

  const createAndSend = useMutation({
    mutationFn: async () => {
      const campaign = await api<{ id: string }>("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          segment,
          templateName,
          templateParams: Object.keys(params).length > 0 ? params : undefined,
          templateSms: smsText.trim(),
        }),
      });
      await api(`/campaigns/${campaign.id}/send`, { method: "POST" });
      return campaign;
    },
    onSuccess: (campaign) => {
      toast("بدأ إرسال الحملة", "success");
      router.replace(`/campaigns/${campaign.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "PLAN_UPGRADE_REQUIRED") setPlanBlocked(true);
      else toast("تعذّر إنشاء الحملة", "error");
    },
  });

  const toggleTag = (t: Tag) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const step1Valid = name.trim().length >= 2;
  const step2Valid = templateName !== null && smsText.trim().length >= 2 &&
    (selectedTemplate?.params ?? []).every((p) => (params[p] ?? "").trim().length > 0);

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none";
  const previewBody = selectedTemplate
    ? selectedTemplate.bodyAr
        .replace("{{name}}", "محمد")
        .replace("{{pharmacy}}", "صيدليتك")
        .replace("{{points}}", "١٢٠")
        .replace(/\{\{(\w+)\}\}/g, (_, p) => params[p] || `{{${p}}}`)
    : "";

  if (planBlocked) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-10 text-center shadow-sm">
        <p className="text-3xl">🚀</p>
        <h1 className="mt-3 text-xl font-bold text-slate-900">الحملات متاحة في الباقة الاحترافية</h1>
        <p className="mt-2 text-sm text-slate-500">
          باقتك الحالية مجانية. للوصول للحملات التسويقية المستهدفة، تواصل معنا لترقية باقتك إلى PRO.
        </p>
        <Link href="/campaigns" className="mt-6 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          العودة للحملات
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/campaigns" className="text-sm text-emerald-700 hover:underline">‹ الحملات</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">حملة جديدة</h1>
      </div>

      {/* stepper */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-emerald-600" : "bg-slate-200"}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">١ · اسم الحملة والشريحة المستهدفة</h2>
          <div>
            <label className="mb-1 block text-sm font-medium">اسم الحملة</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="عرض رمضان للعملاء الغائبين" className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الوسوم <span className="text-slate-400">(اختياري — بدون تحديد = الكل)</span></label>
            <div className="flex gap-2">
              {([["CHRONIC", "مرض مزمن"], ["VIP", "مميّز"]] as [Tag, string][]).map(([v, label]) => (
                <button key={v} type="button" onClick={() => toggleTag(v)}
                  className={`rounded-full px-3 py-1 text-sm ${tags.includes(v) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">غائب منذ (يوم) <span className="text-slate-400">(اختياري)</span></label>
              <input type="number" min={1} dir="ltr" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} placeholder="30" className={`${field} text-left`} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">نقاط ≥ <span className="text-slate-400">(اختياري)</span></label>
              <input type="number" min={0} dir="ltr" value={minPoints} onChange={(e) => setMinPoints(e.target.value)} placeholder="100" className={`${field} text-left`} />
            </div>
          </div>
          <p className="text-xs text-slate-400">المتوقفون عن استقبال الرسائل يُستبعدون تلقائيًا دائمًا.</p>
          <button type="button" disabled={!step1Valid} onClick={() => setStep(2)}
            className="w-full rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
            التالي: اختيار القالب
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">٢ · قالب الرسالة <span className="text-xs font-normal text-slate-400">(قوالب واتساب معتمدة فقط)</span></h2>
          <div className="space-y-2">
            {(templates.data ?? []).map((t) => (
              <button key={t.name} type="button" onClick={() => { setTemplateName(t.name); setParams({}); }}
                className={`w-full rounded-xl border p-3 text-right ${templateName === t.name ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-slate-300"}`}>
                <div className="font-medium text-slate-800">{t.titleAr}</div>
                <div className="mt-1 text-xs text-slate-500">{t.bodyAr}</div>
              </button>
            ))}
          </div>
          {selectedTemplate && selectedTemplate.params.length > 0 && (
            <div className="space-y-2">
              {selectedTemplate.params.map((p) => (
                <div key={p}>
                  <label className="mb-1 block text-sm font-medium">قيمة {`{{${p}}}`}</label>
                  <input value={params[p] ?? ""} onChange={(e) => setParams((prev) => ({ ...prev, [p]: e.target.value }))}
                    placeholder="خصم ١٥٪ على كل المكملات" className={field} />
                </div>
              ))}
            </div>
          )}
          {selectedTemplate && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <span className="mb-1 block text-xs text-slate-400">معاينة الرسالة:</span>
              {previewBody}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">نص SMS البديل <span className="text-slate-400">(عند تعذّر واتساب)</span></label>
            <textarea value={smsText} onChange={(e) => setSmsText(e.target.value)} rows={2} maxLength={160}
              placeholder="عرض خاص في {{pharmacy}} — في انتظارك!" className={`${field} resize-none`} />
            <p className="mt-1 text-xs text-slate-400">{arDigits(smsText.length)}/١٦٠ حرف</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-slate-600 hover:bg-slate-50">رجوع</button>
            <button type="button" disabled={!step2Valid} onClick={() => setStep(3)}
              className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
              التالي: المراجعة والإرسال
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">٣ · المراجعة النهائية</h2>
          {/* the hard stop: count + cost must load before send enables */}
          {preview.isLoading ? (
            <p className="py-6 text-center text-slate-400">جارٍ حساب الشريحة…</p>
          ) : preview.isError ? (
            <p className="py-6 text-center text-red-600">تعذّر حساب الشريحة — أعد المحاولة</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-emerald-50 p-4 text-center">
                <div className="text-3xl font-bold text-emerald-700">{arDigits(preview.data!.recipients)}</div>
                <div className="mt-1 text-sm text-emerald-600">عميل سيستقبل الرسالة</div>
              </div>
              <div className="rounded-xl bg-amber-50 p-4 text-center">
                <div className="text-3xl font-bold text-amber-700">{egp(preview.data!.estCostEgp)}</div>
                <div className="mt-1 text-sm text-amber-600">تكلفة تقديرية (شاملة ~١٠٪ SMS)</div>
              </div>
            </div>
          )}
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between py-1"><span className="text-slate-500">الحملة</span><span className="font-medium text-slate-800">{name}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-500">القالب</span><span className="font-medium text-slate-800">{selectedTemplate?.titleAr}</span></div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">الشريحة</span>
              <span className="font-medium text-slate-800">
                {tags.length > 0 ? tags.map((t) => (t === "CHRONIC" ? "مزمن" : "مميّز")).join("، ") : "الكل"}
                {inactiveDays && ` · غائب ${arDigits(inactiveDays)} يوم`}
                {minPoints && ` · نقاط ≥ ${arDigits(minPoints)}`}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-slate-600 hover:bg-slate-50">رجوع</button>
            <button
              type="button"
              disabled={!preview.data || preview.data.recipients === 0 || createAndSend.isPending}
              onClick={() => createAndSend.mutate()}
              className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {createAndSend.isPending
                ? "جارٍ الإرسال…"
                : preview.data
                  ? `إرسال إلى ${arDigits(preview.data.recipients)} عميل`
                  : "إرسال"}
            </button>
          </div>
          {preview.data?.recipients === 0 && (
            <p className="text-center text-xs text-amber-600">لا يوجد عملاء مطابقون لهذه الشريحة — عدّل الفلاتر في الخطوة ١</p>
          )}
        </div>
      )}
    </div>
  );
}
