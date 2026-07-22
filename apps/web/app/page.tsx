import Link from "next/link";
import type { ReactNode } from "react";

/* ---------------- inline icons (no external deps) ---------------- */
const Icon = ({ path, className = "h-6 w-6" }: { path: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {path}
  </svg>
);
const IconGift = <Icon path={<><path d="M20 12v9H4v-9" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7S9.5 2 7 4s2 3 5 3M12 7s2.5-5 5-3-2 3-5 3" /></>} />;
const IconBell = <Icon path={<><path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>} />;
const IconBolt = <Icon path={<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />} />;
const IconChart = <Icon path={<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>} />;
const IconUsers = <Icon path={<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" /></>} />;
const IconGlobe = <Icon path={<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" /></>} />;
const IconCheck = <Icon className="h-5 w-5" path={<path d="M20 6 9 17l-5-5" />} />;

/* ---------------- content ---------------- */
const PAINS = [
  { t: "العميل بيجي مرة وبينساك", d: "مفيش سبب يخليه يرجع لصيدليتك انت بالذات بدل أقرب صيدلية." },
  { t: "مرضى الأمراض المزمنة بينسوا مواعيد الدوا", d: "مريض الضغط والسكر بيصرف من حد تاني، وانت خسرت بيع شهري مضمون." },
  { t: "مش عارف مين أهم عملائك", d: "ولا مين اللي كان بيشتري بانتظام ووقف من غير ما تاخد بالك." },
  { t: "الصيدليات الكبيرة بتعمل عروض ونقاط", d: "والزبون بيتحوّل لهم، وانت مالكش أداة تنافس بيها." },
];

const BENEFITS = [
  { icon: IconGift, t: "نقاط ولاء تلقائية", d: "كل عملية بيع بتكسّب العميل نقاط يستبدلها بخصم — سبب حقيقي يخليه يرجع لصيدليتك." },
  { icon: IconBell, t: "تذكير واتساب تلقائي", d: "النظام بيبعت للمريض قبل ما دواه يخلص بأيام — بيع شهري متكرر من غير مجهود." },
  { icon: IconBolt, t: "تسجيل بيع في ثوانٍ", d: "رقم + منتج + مبلغ. يشتغل حتى لو النت فصل، والبيانات بترفع نفسها لما يرجع." },
  { icon: IconChart, t: "تعرف صيدليتك بالأرقام", d: "مين بيصرف كتير، مين غايب، وإجمالي مبيعات اليوم — في لوحة واحدة واضحة." },
  { icon: IconUsers, t: "حملات استرجاع العملاء", d: "رسالة واحدة ترجّع العملاء الغايبين وتفكّرهم بعروضك." },
  { icon: IconGlobe, t: "عربي بالكامل، يمين لشمال", d: "متصمم للصيدلية المصرية — أرقام عربية، أسماء عربية، بدون أي تعقيد." },
];

const STATS = [
  { n: "٥ ثوانٍ", l: "لتسجيل عملية بيع" },
  { n: "بدون نت", l: "تسجّل حتى وقت انقطاع الإنترنت" },
  { n: "تلقائي", l: "تذكير مواعيد الأدوية" },
  { n: "١٠٠٪", l: "واجهة عربية" },
];

const STEPS = [
  { n: "١", t: "سجّل البيع", d: "اضغط F2 من أي شاشة، اكتب رقم العميل والمنتج والمبلغ — تمام." },
  { n: "٢", t: "النظام بيشتغل لوحده", d: "النقاط بتتحسب، ومواعيد التذكير بتتحدد بدون أي خطوة إضافية." },
  { n: "٣", t: "العميل بيرجع", d: "رسالة تذكير أو نقاط جاهزة للاستبدال بترجّعه لصيدليتك تاني." },
];

export default function HomePage() {
  return (
    <div className="bg-white text-slate-800">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white">ص</span>
            <span className="text-xl font-bold text-slate-900">صيدلي</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:bg-slate-100">
              تسجيل الدخول
            </Link>
            <Link href="/signup" className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-700">
              ابدأ مجانًا
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50 via-white to-white" />
        <div className="absolute -left-24 -top-24 -z-10 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              مصمم خصيصًا للصيدليات المصرية
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.15] text-slate-900 sm:text-5xl">
              حوّل كل عملية بيع
              <br />
              إلى <span className="text-emerald-600">عميل دائم</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              نظام نقاط ولاء وتذكير تلقائي بمواعيد الأدوية عبر واتساب — عشان مريض
              الضغط والسكر يفضل يصرف من صيدليتك كل شهر، وعشان كل زبون يلاقي سبب
              يرجع لك تاني.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/signup" className="rounded-xl bg-emerald-600 px-8 py-3.5 text-lg font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-700">
                ابدأ مجانًا الآن
              </Link>
              <Link href="/login" className="rounded-xl border border-slate-300 bg-white px-8 py-3.5 text-lg font-medium text-slate-700 hover:bg-slate-50">
                لديّ حساب
              </Link>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
              <span className="text-emerald-600">{IconCheck}</span>
              بدون كارت ائتمان · تجهيز في دقائق
            </p>
          </div>

          {/* ---- product mockup ---- */}
          <div className="relative">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-300/40">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="font-bold text-slate-800">تسجيل بيع</span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">F2</span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-left text-slate-600" dir="ltr">01012345678</div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-medium text-emerald-800">أحمد محمود · ١٢٠ نقطة</span>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">كونكور ٥ مج × ٢</div>
                <div className="flex items-center justify-between rounded-lg bg-emerald-600 px-4 py-2.5 font-bold text-white">
                  <span>حفظ البيع</span>
                  <span>‏١٨٥ ج.م</span>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-700">
                ‏+١٨ نقطة لأحمد 🎉
              </div>
            </div>

            {/* WhatsApp reminder bubble */}
            <div className="absolute -bottom-8 -left-6 w-64 rotate-[-3deg] rounded-2xl bg-white p-4 shadow-xl shadow-slate-300/50 ring-1 ring-slate-100">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#25D366] text-white">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-1.5-.5-3.9-2.4-4.9-4.6-.2-.4-.6-1.3-.6-2s.4-1 .5-1.2c.2-.2.4-.2.5-.2h.4c.2 0 .3 0 .5.4l.6 1.5c.1.2 0 .4 0 .5l-.4.5c-.1.1-.2.3-.1.5.3.6.8 1.2 1.3 1.6.5.4 1 .6 1.3.7.2.1.3 0 .5-.1l.6-.7c.2-.2.3-.1.5-.1l1.4.7c.2.1.3.2.4.3 0 .2 0 .8-.3 1.2Z" /></svg>
                </span>
                <span className="text-sm font-bold text-slate-800">صيدلية النور</span>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                فاضل ٣ أيام على انتهاء دوا الضغط 💊 تحب نجهّزه لحضرتك؟
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- stats strip ---------------- */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.l} className="text-center">
              <p className="text-2xl font-bold text-emerald-600 sm:text-3xl">{s.n}</p>
              <p className="mt-1 text-sm text-slate-500">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- pain points ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900">مشاكل بتقابلها كل صيدلية</h2>
          <p className="mt-3 text-lg text-slate-600">لو أي واحدة من دول بتحصل معاك، انت بتخسر فلوس كل شهر.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {PAINS.map((p) => (
            <div key={p.t} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-6">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-50 text-lg font-bold text-red-500">✕</span>
              <div>
                <h3 className="font-bold text-slate-900">{p.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{p.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- benefits ---------------- */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-bold text-emerald-600">الحل</span>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">كل اللي محتاجه علشان عملاءك يرجعوا</h2>
            <p className="mt-3 text-lg text-slate-600">أدوات بسيطة تشتغل من أول يوم، من غير تدريب ولا تعقيد.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.t} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-200">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600">{b.icon}</div>
                <h3 className="mt-4 text-lg font-bold text-slate-900">{b.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-slate-900">إزاي بيشتغل؟</h2>
          <p className="mt-3 text-lg text-slate-600">ثلاث خطوات، وصيدليتك بتشتغل بذكاء.</p>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-slate-200 bg-white p-7 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white">{s.n}</span>
              <h3 className="mt-5 text-lg font-bold text-slate-900">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- final CTA ---------------- */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 px-8 py-14 text-center shadow-2xl shadow-emerald-600/25">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">جاهز تخلّي صيدليتك تكبر؟</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-emerald-50">
            انضم للصيدليات اللي بتحوّل كل عملية بيع لعلاقة طويلة مع العميل. ابدأ
            دلوقتي مجانًا — من غير أي التزام.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/signup" className="rounded-xl bg-white px-8 py-3.5 text-lg font-bold text-emerald-700 shadow-lg transition hover:bg-emerald-50">
              إنشاء حساب مجاني
            </Link>
            <Link href="/login" className="rounded-xl border border-white/40 px-8 py-3.5 text-lg font-medium text-white hover:bg-white/10">
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-sm font-bold text-white">ص</span>
            <span className="font-bold text-slate-900">صيدلي</span>
          </div>
          <p className="text-sm text-slate-500">© {new Date().getFullYear()} صيدلي — نظام إدارة الصيدليات المصرية</p>
        </div>
      </footer>
    </div>
  );
}
