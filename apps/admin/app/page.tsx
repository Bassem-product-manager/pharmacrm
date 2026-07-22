"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Super-admin BI console (docs/06 + docs/metrics.md).
 * Dependency-free by design (internal tool): plain fetch + inline styles +
 * hand-rolled SVG charts. Data comes from the metric layer ONLY
 * (/admin/analytics/kpis|series|distribution) — no widget computes its own
 * numbers, so every view agrees with every export.
 * - Global date filter (presets + custom) drives KPIs, widgets, exports.
 * - Each analytics widget has its OWN metric + chart-type selectors
 *   (persisted per-section in sessionStorage for the session).
 * - Blocking requires a reason via confirmation modal (audited server-side).
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

// ---------- types ----------
type Period = "day" | "week" | "month" | "quarter" | "year" | "custom";
type Kpi = { current: number; previous: number | null; growthPct: number | null };
interface Kpis {
  range: { from: string; to: string };
  revenue: Kpi; sales: Kpi; avgOrderValue: Kpi; newCustomers: Kpi; newPharmacies: Kpi;
  messages: Kpi; activePharmacies: Kpi; totalPharmacies: Kpi; totalCustomers: Kpi;
  proSubscribers: Kpi; freeSubscribers: Kpi; blockedPharmacies: Kpi; conversionRatePct: Kpi;
}
interface Series { metric: string; granularity: string; buckets: { bucket: string; value: number }[] }
interface Distribution { metric: string; by: string; slices: { label: string; value: number }[] }
interface PharmacyRow {
  id: string; name: string; city: string | null; plan: "FREE" | "PRO"; blockedAt: string | null;
  customers: number; users: number; sales30d: number; revenue30dEgp: number;
  lastActive: string | null; createdAt: string;
}
interface Analytics {
  pharmacy: { id: string; name: string; city: string | null; plan: string; joinedAt: string; blockedAt: string | null };
  period: Period; windowDays: number;
  current: { revenueEgp: number; salesCount: number; avgBasketEgp: number; newCustomers: number };
  previous: { revenueEgp: number; salesCount: number; newCustomers: number };
  growth: { revenuePct: number | null; salesPct: number | null; newCustomersPct: number | null };
  topProducts: { name: string; qty: number; revenueEgp: number }[];
  topCategories: { category: string; qty: number; revenueEgp: number }[];
  topCustomers: { customerId: string; name: string; phone: string; salesCount: number; spendEgp: number }[];
  trend: { bucket: string; revenueEgp: number; salesCount: number }[];
}
interface MessagingStats {
  totals: { messages: number; deliveryRate: number; fallbackRatio: number };
  perPharmacy: { pharmacyId: string; name: string; messages: number; deliveryRate: number; failed: number; costEgp: number }[];
}
interface AuditRow { id: string; action: string; userId: string; diff: unknown; createdAt: string; pharmacy: { name: string } }

// ---------- styles ----------
const S = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 1150, margin: "0 auto", padding: 24, color: "#0f172a" } as React.CSSProperties,
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20 } as React.CSSProperties,
  th: { textAlign: "left", padding: "8px 10px", color: "#64748b", fontWeight: 500, fontSize: 13, borderBottom: "1px solid #e2e8f0" } as React.CSSProperties,
  td: { padding: "8px 10px", fontSize: 14, borderBottom: "1px solid #f1f5f9" } as React.CSSProperties,
  btn: { padding: "6px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: 13 } as React.CSSProperties,
  btnPrimary: { padding: "8px 18px", borderRadius: 8, border: 0, background: "#059669", color: "#fff", cursor: "pointer", fontWeight: 700 } as React.CSSProperties,
  btnDanger: { padding: "6px 14px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontSize: 13 } as React.CSSProperties,
  chip: (on: boolean) => ({ ...S.btn, padding: "4px 10px", fontSize: 12, ...(on ? { background: "#059669", color: "#fff", borderColor: "#059669" } : {}) }) as React.CSSProperties,
  input: { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", width: "100%", boxSizing: "border-box" } as React.CSSProperties,
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))", gap: 12, marginBottom: 20 } as React.CSSProperties,
};
const badge = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 });
const egp = (n: number) => `${n.toLocaleString("en-EG", { maximumFractionDigits: 0 })} EGP`;
const COLORS = ["#059669", "#0284c7", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#65a30d", "#be185d", "#475569", "#ca8a04", "#4f46e5", "#0d9488"];

// ---------- date helpers ----------
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
  { key: "today", label: "Today", range: () => ({ from: iso(new Date()), to: iso(new Date()) }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ from: daysAgo(1), to: daysAgo(1) }) },
  { key: "7d", label: "Last 7d", range: () => ({ from: daysAgo(6), to: iso(new Date()) }) },
  { key: "30d", label: "Last 30d", range: () => ({ from: daysAgo(29), to: iso(new Date()) }) },
  {
    key: "thisMonth", label: "This month",
    range: () => { const n = new Date(); return { from: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), to: iso(n) }; },
  },
  {
    key: "prevMonth", label: "Prev month",
    range: () => {
      const n = new Date();
      return {
        from: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))),
        to: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0))),
      };
    },
  },
  { key: "quarter", label: "This quarter", range: () => ({ from: daysAgo(89), to: iso(new Date()) }) },
  {
    key: "thisYear", label: "This year",
    range: () => { const n = new Date(); return { from: `${n.getUTCFullYear()}-01-01`, to: iso(n) }; },
  },
  {
    key: "prevYear", label: "Prev year",
    range: () => { const y = new Date().getUTCFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; },
  },
];

// ---------- tiny chart components (SVG, no libs) ----------
function ChartFrame({ children, h = 150 }: { children: React.ReactNode; h?: number }) {
  return <svg viewBox={`0 0 900 ${h + 22}`} style={{ width: "100%", height: "auto" }} role="img">{children}</svg>;
}
function axisLabels(buckets: { bucket: string }[], h: number) {
  if (buckets.length === 0) return null;
  const first = buckets[0].bucket, last = buckets[buckets.length - 1].bucket;
  return (
    <>
      <text x={4} y={h + 16} fontSize={10} fill="#94a3b8">{first}</text>
      <text x={896} y={h + 16} fontSize={10} fill="#94a3b8" textAnchor="end">{last}</text>
    </>
  );
}
function BarsChart({ data, h = 150 }: { data: { bucket: string; value: number }[]; h?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = 900 / Math.max(data.length, 1);
  return (
    <ChartFrame h={h}>
      {data.map((d, i) => {
        const bh = Math.round((d.value / max) * (h - 8));
        return (
          <rect key={d.bucket} x={i * bw + 1.5} y={h - bh} width={Math.max(bw - 3, 2)} height={bh} rx={2} fill="#059669" opacity={0.85}>
            <title>{`${d.bucket}: ${d.value.toLocaleString()}`}</title>
          </rect>
        );
      })}
      {axisLabels(data, h)}
    </ChartFrame>
  );
}
function LineChart({ data, area = false, h = 150 }: { data: { bucket: string; value: number }[]; area?: boolean; h?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = 900 / Math.max(data.length - 1, 1);
  const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(h - (d.value / max) * (h - 8)).toFixed(1)}`);
  return (
    <ChartFrame h={h}>
      {area && <polygon points={`0,${h} ${pts.join(" ")} 900,${h}`} fill="#059669" opacity={0.15} />}
      <polyline points={pts.join(" ")} fill="none" stroke="#059669" strokeWidth={2.5} />
      {data.map((d, i) => (
        <circle key={d.bucket} cx={i * step} cy={h - (d.value / max) * (h - 8)} r={5} fill="#059669" opacity={data.length > 40 ? 0 : 0.9}>
          <title>{`${d.bucket}: ${d.value.toLocaleString()}`}</title>
        </circle>
      ))}
      {axisLabels(data, h)}
    </ChartFrame>
  );
}
function DonutChart({ slices }: { slices: { label: string; value: number }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p style={{ color: "#94a3b8", fontSize: 13 }}>No data in this range</p>;
  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 160 160" style={{ width: 170, height: 170 }} role="img">
        {slices.map((s, i) => {
          const frac = s.value / total;
          const el = (
            <circle
              key={s.label} cx={80} cy={80} r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={26}
              strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`}
              strokeDashoffset={(-offset * C).toFixed(2)} transform="rotate(-90 80 80)"
            >
              <title>{`${s.label}: ${s.value.toLocaleString()} (${Math.round(frac * 100)}%)`}</title>
            </circle>
          );
          offset += frac;
          return el;
        })}
        <text x={80} y={85} textAnchor="middle" fontSize={16} fontWeight={800} fill="#0f172a">{total.toLocaleString()}</text>
      </svg>
      <div style={{ fontSize: 13 }}>
        {slices.map((s, i) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], display: "inline-block" }} />
            <span>{s.label}</span>
            <b>{s.value.toLocaleString()}</b>
            <span style={{ color: "#94a3b8" }}>{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function DataTable({ rows, cols }: { rows: (string | number)[][]; cols: string[] }) {
  return (
    <div style={{ maxHeight: 260, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{cols.map((c) => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={S.td}>{typeof c === "number" ? c.toLocaleString() : c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- widgets ----------
function Growth({ pct, prev }: { pct: number | null; prev: number | null }) {
  if (prev === null) return <span style={{ fontSize: 11, color: "#94a3b8" }}>No comparison data</span>;
  if (pct === null) return <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>▲ new</span>;
  const up = pct >= 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: up ? "#059669" : "#dc2626" }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% <span style={{ color: "#94a3b8", fontWeight: 400 }}>vs prev: {prev.toLocaleString()}</span>
    </span>
  );
}
function KpiCard({ label, value, k, onClick, tone }: { label: string; value: string; k: Kpi; onClick?: () => void; tone?: string }) {
  return (
    <div
      style={{ ...S.card, marginBottom: 0, padding: 14, cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      title={onClick ? "Click for details" : undefined}
    >
      <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 4, color: tone ?? "#0f172a" }}>{value}</div>
      <div style={{ marginTop: 3 }}><Growth pct={k.growthPct} prev={k.previous} /></div>
    </div>
  );
}
/** sessionStorage-persisted selector state per widget section. */
function usePersisted<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    const saved = sessionStorage.getItem(`bi.${key}`);
    if (saved) setV(saved as T);
  }, [key]);
  return [v, (nv: T) => { sessionStorage.setItem(`bi.${key}`, nv); setV(nv); }];
}

const TREND_METRICS = [
  { key: "revenue", label: "Revenue", unit: "EGP" },
  { key: "sales", label: "Sales", unit: "" },
  { key: "customers", label: "Customers", unit: "" },
  { key: "pharmacies", label: "Pharmacies", unit: "" },
  { key: "messages", label: "Messages", unit: "" },
] as const;
const DIST_METRICS = [
  { key: "revenue", label: "Revenue" },
  { key: "sales", label: "Sales" },
  { key: "subscribers", label: "Subscriptions" },
  { key: "customers", label: "Customers" },
  { key: "messages", label: "Messages" },
] as const;
const DIST_DIMS = [
  { key: "pharmacy", label: "by Pharmacy" },
  { key: "plan", label: "by Plan" },
  { key: "category", label: "by Category" },
] as const;

export default function AdminConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("admin@pharmacrm.local");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<"overview" | "pharmacies" | "messaging" | "audit">("overview");

  // global date filter
  const [preset, setPreset] = useState("30d");
  const [range, setRange] = useState(PRESETS.find((p) => p.key === "30d")!.range());
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  // metric-layer data
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [kpisErr, setKpisErr] = useState(false);
  const [trend, setTrend] = useState<Series | null>(null);
  const [dist, setDist] = useState<Distribution | null>(null);

  // per-section selectors (persisted for the session)
  const [trendMetric, setTrendMetric] = usePersisted<(typeof TREND_METRICS)[number]["key"]>("trend.metric", "revenue");
  const [trendChart, setTrendChart] = usePersisted<"line" | "bar" | "area" | "table">("trend.chart", "line");
  const [distMetric, setDistMetric] = usePersisted<(typeof DIST_METRICS)[number]["key"]>("dist.metric", "subscribers");
  const [distBy, setDistBy] = usePersisted<(typeof DIST_DIMS)[number]["key"]>("dist.by", "plan");
  const [distChart, setDistChart] = usePersisted<"donut" | "bar" | "table">("dist.chart", "donut");

  const [pharmacies, setPharmacies] = useState<PharmacyRow[] | null>(null);
  const [stats, setStats] = useState<MessagingStats | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState<"ALL" | "FREE" | "PRO">("ALL");

  // pharmacy drill-in
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [phFrom, setPhFrom] = useState(daysAgo(29));
  const [phTo, setPhTo] = useState(iso(new Date()));
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsErr, setAnalyticsErr] = useState(false);

  // block modal
  const [blockModal, setBlockModal] = useState<{ id: string; name: string } | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [blockNote, setBlockNote] = useState("");

  useEffect(() => { setToken(sessionStorage.getItem("admin_token")); }, []);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
      });
      if (res.status === 401) { sessionStorage.removeItem("admin_token"); setToken(null); throw new Error("session expired"); }
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<T>;
    },
    [token],
  );
  const download = useCallback(
    async (path: string, fallback: string) => {
      const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return alert(`Download failed (${res.status})`);
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    [token],
  );

  const qs = `from=${range.from}&to=${range.to}`;

  // KPIs + directory + ops — refetch when token or global range changes
  useEffect(() => {
    if (!token) return;
    setKpis(null); setKpisErr(false);
    call<Kpis>(`/admin/analytics/kpis?${qs}`).then(setKpis).catch(() => setKpisErr(true));
    call<{ data: PharmacyRow[] }>("/admin/pharmacies?sort=lastActive").then((r) => setPharmacies(r.data)).catch(() => undefined);
    call<MessagingStats>("/admin/messaging/stats").then(setStats).catch(() => undefined);
    call<{ data: AuditRow[] }>("/admin/audit").then((r) => setAudit(r.data)).catch(() => undefined);
  }, [token, qs, call]);

  // trend widget — independent query per metric selection
  useEffect(() => {
    if (!token) return;
    setTrend(null);
    call<Series>(`/admin/analytics/series?metric=${trendMetric}&${qs}`).then(setTrend).catch(() => undefined);
  }, [token, trendMetric, qs, call]);

  // distribution widget
  useEffect(() => {
    if (!token) return;
    setDist(null);
    call<Distribution>(`/admin/analytics/distribution?metric=${distMetric}&by=${distBy}&${qs}`).then(setDist).catch(() => undefined);
  }, [token, distMetric, distBy, qs, call]);

  // pharmacy drill-in
  useEffect(() => {
    if (!token || !selected) return;
    setAnalytics(null); setAnalyticsErr(false);
    const extra = period === "custom" ? `&from=${phFrom}&to=${phTo}` : "";
    call<Analytics>(`/admin/pharmacies/${selected}/analytics?period=${period}${extra}`)
      .then(setAnalytics).catch(() => setAnalyticsErr(true));
  }, [token, selected, period, phFrom, phTo, call]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setLoginError("");
    try {
      const res = await fetch(`${API}/admin/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { accessToken: string };
      sessionStorage.setItem("admin_token", body.accessToken); setToken(body.accessToken);
    } catch { setLoginError("Invalid credentials"); }
  };

  const refreshDirectory = useCallback(async () => {
    const r = await call<{ data: PharmacyRow[] }>("/admin/pharmacies?sort=lastActive");
    setPharmacies(r.data);
  }, [call]);

  const switchPlan = async (p: { id: string; name: string; plan: string }) => {
    const next = p.plan === "FREE" ? "PRO" : "FREE";
    if (!confirm(`Switch "${p.name}" to ${next}?`)) return;
    setBusy(p.id);
    try {
      await call(`/admin/pharmacies/${p.id}/plan`, { method: "PATCH", body: JSON.stringify({ plan: next }) });
      await refreshDirectory();
      if (selected === p.id) setAnalytics((a) => (a ? { ...a, pharmacy: { ...a.pharmacy, plan: next } } : a));
    } finally { setBusy(null); }
  };

  const submitBlock = async () => {
    if (!blockModal || blockReason.trim().length < 3) return;
    setBusy(blockModal.id);
    try {
      await call(`/admin/pharmacies/${blockModal.id}/block`, {
        method: "POST",
        body: JSON.stringify({ reason: blockReason.trim(), ...(blockNote.trim() ? { note: blockNote.trim() } : {}) }),
      });
      await refreshDirectory();
      if (selected === blockModal.id) {
        setAnalytics((a) => (a ? { ...a, pharmacy: { ...a.pharmacy, blockedAt: new Date().toISOString() } } : a));
      }
      setBlockModal(null); setBlockReason(""); setBlockNote("");
    } finally { setBusy(null); }
  };
  const unblock = async (id: string) => {
    if (!confirm("Unblock this pharmacy? It will regain access immediately.")) return;
    setBusy(id);
    try {
      await call(`/admin/pharmacies/${id}/unblock`, { method: "POST" });
      await refreshDirectory();
      if (selected === id) setAnalytics((a) => (a ? { ...a, pharmacy: { ...a.pharmacy, blockedAt: null } } : a));
    } finally { setBusy(null); }
  };

  const openPharmacyByName = (name: string) => {
    const p = pharmacies?.find((x) => x.name === name);
    if (p) { setTab("pharmacies"); setSelected(p.id); }
  };

  const trendUnit = TREND_METRICS.find((m) => m.key === trendMetric)?.unit ?? "";
  const trendTitle = `${TREND_METRICS.find((m) => m.key === trendMetric)?.label} trend ${trend ? `(${trend.granularity === "month" ? "monthly" : "daily"})` : ""}`;
  const distTitle = `${DIST_METRICS.find((m) => m.key === distMetric)?.label} ${DIST_DIMS.find((d) => d.key === distBy)?.label}`;
  const visiblePharmacies = useMemo(
    () => (pharmacies ?? []).filter((p) => planFilter === "ALL" || p.plan === planFilter),
    [pharmacies, planFilter],
  );

  if (!token) {
    return (
      <main style={{ ...S.page, maxWidth: 380, paddingTop: 80 }}>
        <div style={S.card}>
          <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>PharmaCRM Admin</h1>
          <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: 14 }}>Business console — super admin only</p>
          <form onSubmit={login}>
            <label style={{ fontSize: 13, color: "#475569" }}>Email</label>
            <input style={{ ...S.input, margin: "4px 0 12px" }} value={email} onChange={(e) => setEmail(e.target.value)} />
            <label style={{ fontSize: 13, color: "#475569" }}>Password</label>
            <input style={{ ...S.input, margin: "4px 0 16px" }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {loginError && <p style={{ color: "#dc2626", fontSize: 13 }}>{loginError}</p>}
            <button style={{ ...S.btnPrimary, width: "100%" }} type="submit">Sign in</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main style={S.page}>
      <style>{`@media print { .no-print { display:none !important; } main { max-width:100% !important; padding:0 !important; } }`}</style>

      {/* header + tabs */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>PharmaCRM Admin</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["overview", "pharmacies", "messaging", "audit"] as const).map((t) => (
            <button key={t} style={S.chip(tab === t)} onClick={() => { setTab(t); setSelected(null); }}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button style={S.btn} onClick={() => window.print()}>🖨 PDF</button>
          <button style={S.btn} onClick={() => download(`/admin/reports/export.xls?${qs}`, "report.xls")}>⬇ Excel</button>
          <button style={S.btn} onClick={() => { sessionStorage.removeItem("admin_token"); setToken(null); }}>Logout</button>
        </div>
      </div>

      {/* global filter bar */}
      <div className="no-print" style={{ ...S.card, padding: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {PRESETS.map((p) => (
          <button key={p.key} style={S.chip(preset === p.key)} onClick={() => { setPreset(p.key); setRange(p.range()); }}>
            {p.label}
          </button>
        ))}
        <span style={{ color: "#cbd5e1" }}>|</span>
        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...S.input, width: 140, padding: "4px 8px" }} />
        <span style={{ color: "#64748b" }}>→</span>
        <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ ...S.input, width: 140, padding: "4px 8px" }} />
        <button style={S.chip(preset === "custom")} onClick={() => { if (customFrom <= customTo) { setPreset("custom"); setRange({ from: customFrom, to: customTo }); } }}>
          Apply
        </button>
        <button style={S.btn} onClick={() => { setPreset("30d"); setRange(PRESETS.find((p) => p.key === "30d")!.range()); }}>Reset</button>
        <span style={{ marginInlineStart: "auto", fontSize: 12, color: "#64748b" }}>
          Active: <b>{range.from}</b> → <b>{range.to}</b>
        </span>
      </div>

      {/* ---------------- OVERVIEW ---------------- */}
      {tab === "overview" && (
        <>
          {kpisErr ? (
            <div style={S.card}><span style={{ color: "#dc2626" }}>Failed to load KPIs — retry via Reset.</span></div>
          ) : !kpis ? (
            <div style={S.card}>Loading KPIs…</div>
          ) : (
            <div style={S.kpiGrid}>
              <KpiCard label="Revenue (period)" value={egp(kpis.revenue.current)} k={kpis.revenue} tone="#059669" onClick={() => setTrendMetric("revenue")} />
              <KpiCard label="Sales (period)" value={kpis.sales.current.toLocaleString()} k={kpis.sales} onClick={() => setTrendMetric("sales")} />
              <KpiCard label="Avg order value" value={egp(kpis.avgOrderValue.current)} k={kpis.avgOrderValue} />
              <KpiCard label="New customers" value={kpis.newCustomers.current.toLocaleString()} k={kpis.newCustomers} onClick={() => setTrendMetric("customers")} />
              <KpiCard label="New pharmacies" value={kpis.newPharmacies.current.toLocaleString()} k={kpis.newPharmacies} onClick={() => setTrendMetric("pharmacies")} />
              <KpiCard label="Messages" value={kpis.messages.current.toLocaleString()} k={kpis.messages} onClick={() => setTrendMetric("messages")} />
              <KpiCard label="Active pharmacies (period)" value={kpis.activePharmacies.current.toLocaleString()} k={kpis.activePharmacies} onClick={() => setTab("pharmacies")} />
              <KpiCard label="Total pharmacies" value={kpis.totalPharmacies.current.toLocaleString()} k={kpis.totalPharmacies} onClick={() => setTab("pharmacies")} />
              <KpiCard label="Total customers" value={kpis.totalCustomers.current.toLocaleString()} k={kpis.totalCustomers} />
              <KpiCard label="PRO subscribers" value={kpis.proSubscribers.current.toLocaleString()} k={kpis.proSubscribers} tone="#0369a1" onClick={() => { setTab("pharmacies"); setPlanFilter("PRO"); }} />
              <KpiCard label="FREE pharmacies" value={kpis.freeSubscribers.current.toLocaleString()} k={kpis.freeSubscribers} onClick={() => { setTab("pharmacies"); setPlanFilter("FREE"); }} />
              <KpiCard label="FREE→PRO conversion" value={`${kpis.conversionRatePct.current}%`} k={kpis.conversionRatePct} tone="#7c3aed" />
              <KpiCard label="Blocked pharmacies" value={kpis.blockedPharmacies.current.toLocaleString()} k={kpis.blockedPharmacies} tone={kpis.blockedPharmacies.current > 0 ? "#dc2626" : undefined} onClick={() => setTab("pharmacies")} />
            </div>
          )}

          {/* Trend explorer — independent metric × chart selectors */}
          <div style={S.card}>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {TREND_METRICS.map((m) => (
                  <button key={m.key} style={S.chip(trendMetric === m.key)} onClick={() => setTrendMetric(m.key)}>{m.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["line", "bar", "area", "table"] as const).map((c) => (
                  <button key={c} style={S.chip(trendChart === c)} onClick={() => setTrendChart(c)}>{c[0].toUpperCase() + c.slice(1)}</button>
                ))}
                <button style={S.btn} onClick={() => download(`/admin/reports/export.xls?${qs}`, "report.xls")}>⬇</button>
              </div>
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{trendTitle}{trendUnit ? ` — ${trendUnit}` : ""}</h2>
            {!trend ? (
              <p style={{ color: "#94a3b8" }}>Loading…</p>
            ) : trend.buckets.every((b) => b.value === 0) ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No {trendMetric} recorded between {range.from} and {range.to}.</p>
            ) : trendChart === "table" ? (
              <DataTable cols={["Bucket", TREND_METRICS.find((m) => m.key === trendMetric)!.label]} rows={trend.buckets.map((b) => [b.bucket, b.value])} />
            ) : trendChart === "bar" ? (
              <BarsChart data={trend.buckets} />
            ) : (
              <LineChart data={trend.buckets} area={trendChart === "area"} />
            )}
          </div>

          {/* Distribution explorer */}
          <div style={S.card}>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DIST_METRICS.map((m) => (
                  <button key={m.key} style={S.chip(distMetric === m.key)} onClick={() => setDistMetric(m.key)}>{m.label}</button>
                ))}
                <span style={{ color: "#cbd5e1" }}>|</span>
                {DIST_DIMS.map((d) => (
                  <button key={d.key} style={S.chip(distBy === d.key)} onClick={() => setDistBy(d.key)}>{d.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(["donut", "bar", "table"] as const).map((c) => (
                  <button key={c} style={S.chip(distChart === c)} onClick={() => setDistChart(c)}>{c[0].toUpperCase() + c.slice(1)}</button>
                ))}
              </div>
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{distTitle}</h2>
            {!dist ? (
              <p style={{ color: "#94a3b8" }}>Loading…</p>
            ) : dist.slices.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No data for this combination in the selected range.</p>
            ) : distChart === "table" ? (
              <DataTable cols={[DIST_DIMS.find((d) => d.key === distBy)!.label.replace("by ", ""), DIST_METRICS.find((m) => m.key === distMetric)!.label]} rows={dist.slices.map((s) => [s.label, s.value])} />
            ) : distChart === "bar" ? (
              <div>
                <BarsChart data={dist.slices.map((s) => ({ bucket: s.label, value: s.value }))} h={130} />
                {distBy === "pharmacy" && (
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>Tip: click a pharmacy in the legend/table to drill in.</p>
                )}
              </div>
            ) : (
              <div onClick={(e) => {
                const t = (e.target as SVGElement).querySelector?.("title")?.textContent ?? "";
                const name = t.split(":")[0];
                if (distBy === "pharmacy" && name) openPharmacyByName(name);
              }}>
                <DonutChart slices={dist.slices} />
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------------- PHARMACIES ---------------- */}
      {tab === "pharmacies" && !selected && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Pharmacies ({visiblePharmacies.length})</h2>
            <div className="no-print" style={{ display: "flex", gap: 6 }}>
              {(["ALL", "FREE", "PRO"] as const).map((f) => (
                <button key={f} style={S.chip(planFilter === f)} onClick={() => setPlanFilter(f)}>{f}</button>
              ))}
              <button style={S.btn} onClick={() => download("/admin/reports/pharmacies.csv", "pharmacies.csv")}>⬇ CSV</button>
            </div>
          </div>
          {!pharmacies ? <p style={{ color: "#94a3b8" }}>Loading…</p> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={S.th}>Pharmacy</th><th style={S.th}>Plan</th><th style={S.th}>Customers</th>
                  <th style={S.th}>Sales 30d</th><th style={S.th}>Revenue 30d</th><th style={S.th}>Joined</th><th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {visiblePharmacies.map((p) => (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setSelected(p.id)}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600 }}>{p.name}{" "}{p.blockedAt && <span style={badge("#fee2e2", "#b91c1c")}>BLOCKED</span>}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>{p.city ?? "—"} · {p.users} users</div>
                    </td>
                    <td style={S.td}><span style={p.plan === "PRO" ? badge("#d1fae5", "#047857") : badge("#f1f5f9", "#475569")}>{p.plan}</span></td>
                    <td style={S.td}>{p.customers}</td>
                    <td style={S.td}>{p.sales30d}</td>
                    <td style={S.td}>{egp(p.revenue30dEgp)}</td>
                    <td style={S.td}>{new Date(p.createdAt).toLocaleDateString("en-GB")}</td>
                    <td style={{ ...S.td, color: "#059669", fontWeight: 700 }}>View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "pharmacies" && selected && (
        <>
          <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <button style={S.btn} onClick={() => setSelected(null)}>← All pharmacies</button>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {(["day", "week", "month", "quarter", "year"] as Period[]).map((p) => (
                <button key={p} style={S.chip(period === p)} onClick={() => setPeriod(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
              ))}
              <input type="date" value={phFrom} onChange={(e) => setPhFrom(e.target.value)} style={{ ...S.input, width: 135, padding: "4px 8px" }} />
              <span style={{ color: "#64748b" }}>→</span>
              <input type="date" value={phTo} onChange={(e) => setPhTo(e.target.value)} style={{ ...S.input, width: 135, padding: "4px 8px" }} />
              <button style={S.chip(period === "custom")} onClick={() => phFrom <= phTo && setPeriod("custom")}>Custom</button>
            </div>
          </div>

          {analyticsErr ? (
            <div style={S.card}><span style={{ color: "#dc2626" }}>Failed to load analytics for this pharmacy.</span></div>
          ) : !analytics ? (
            <div style={S.card}>Loading analytics…</div>
          ) : (
            <>
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 20 }}>
                      {analytics.pharmacy.name}{" "}
                      {analytics.pharmacy.blockedAt && <span style={badge("#fee2e2", "#b91c1c")}>BLOCKED</span>}{" "}
                      <span style={analytics.pharmacy.plan === "PRO" ? badge("#d1fae5", "#047857") : badge("#f1f5f9", "#475569")}>{analytics.pharmacy.plan}</span>
                    </h2>
                    <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                      {analytics.pharmacy.city ?? "—"} · joined {new Date(analytics.pharmacy.joinedAt).toLocaleDateString("en-GB")} ·
                      window: {period === "custom" ? `${phFrom} → ${phTo}` : `last ${analytics.windowDays}d`} vs previous {analytics.windowDays}d
                    </div>
                  </div>
                  <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button style={S.btn} disabled={busy === selected} onClick={() => switchPlan({ id: selected, name: analytics.pharmacy.name, plan: analytics.pharmacy.plan })}>
                      {analytics.pharmacy.plan === "FREE" ? "Upgrade → PRO" : "Downgrade → FREE"}
                    </button>
                    {analytics.pharmacy.blockedAt ? (
                      <button style={S.btn} disabled={busy === selected} onClick={() => unblock(selected)}>Unblock</button>
                    ) : (
                      <button style={S.btnDanger} disabled={busy === selected} onClick={() => setBlockModal({ id: selected, name: analytics.pharmacy.name })}>
                        🚫 Block
                      </button>
                    )}
                    <button style={S.btn} onClick={() => download(`/admin/reports/pharmacies/${selected}/analytics.csv?period=${period}${period === "custom" ? `&from=${phFrom}&to=${phTo}` : ""}`, "analytics.csv")}>
                      ⬇ CSV
                    </button>
                  </div>
                </div>
              </div>

              <div style={S.kpiGrid}>
                <KpiCard label={`Revenue (${period})`} value={egp(analytics.current.revenueEgp)} tone="#059669"
                  k={{ current: analytics.current.revenueEgp, previous: analytics.previous.revenueEgp, growthPct: analytics.growth.revenuePct }} />
                <KpiCard label={`Sales (${period})`} value={String(analytics.current.salesCount)}
                  k={{ current: analytics.current.salesCount, previous: analytics.previous.salesCount, growthPct: analytics.growth.salesPct }} />
                <KpiCard label="Avg basket" value={egp(analytics.current.avgBasketEgp)}
                  k={{ current: analytics.current.avgBasketEgp, previous: null, growthPct: null }} />
                <KpiCard label={`New customers (${period})`} value={String(analytics.current.newCustomers)}
                  k={{ current: analytics.current.newCustomers, previous: analytics.previous.newCustomers, growthPct: analytics.growth.newCustomersPct }} />
              </div>

              <div style={S.card}>
                <h3 style={{ marginTop: 0, fontSize: 15 }}>Revenue trend</h3>
                <LineChart data={analytics.trend.map((t) => ({ bucket: t.bucket, value: t.revenueEgp }))} area />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                {[
                  { title: `Top products (${period})`, rows: analytics.topProducts.map((p, i) => [`${i + 1}. ${p.name}`, `${p.qty} pcs · ${egp(p.revenueEgp)}`]) },
                  { title: `Top categories (${period})`, rows: analytics.topCategories.map((c, i) => [`${i + 1}. ${c.category}`, `${c.qty} pcs · ${egp(c.revenueEgp)}`]) },
                  { title: `Top customers (${period})`, rows: analytics.topCustomers.map((c, i) => [`${i + 1}. ${c.name} (${c.phone})`, `${c.salesCount} sales · ${egp(c.spendEgp)}`]) },
                ].map((sec) => (
                  <div key={sec.title} style={S.card}>
                    <h3 style={{ marginTop: 0, fontSize: 15 }}>{sec.title}</h3>
                    {sec.rows.length === 0 ? <p style={{ color: "#94a3b8", fontSize: 13 }}>No sales in window</p> : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <tbody>
                          {sec.rows.map((r, i) => (
                            <tr key={i}><td style={S.td}>{r[0]}</td><td style={{ ...S.td, textAlign: "right" }}>{r[1]}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ---------------- MESSAGING ---------------- */}
      {tab === "messaging" && stats && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Messaging — last 30 days</h2>
            <button className="no-print" style={S.btn} onClick={() => download("/admin/reports/messaging.csv", "messaging.csv")}>⬇ CSV</button>
          </div>
          <p style={{ color: "#64748b", fontSize: 14 }}>
            {stats.totals.messages} messages · delivery {(stats.totals.deliveryRate * 100).toFixed(0)}% · fallback {(stats.totals.fallbackRatio * 100).toFixed(0)}%
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={S.th}>Pharmacy</th><th style={S.th}>Messages</th><th style={S.th}>Delivery</th><th style={S.th}>Failed</th><th style={S.th}>Cost</th></tr></thead>
            <tbody>
              {stats.perPharmacy.map((r) => (
                <tr key={r.pharmacyId}>
                  <td style={S.td}>{r.name}</td><td style={S.td}>{r.messages}</td>
                  <td style={S.td}>{(r.deliveryRate * 100).toFixed(0)}%</td><td style={S.td}>{r.failed}</td>
                  <td style={S.td}>{r.costEgp.toFixed(2)} EGP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- AUDIT ---------------- */}
      {tab === "audit" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Audit trail (latest 100)</h2>
            <button className="no-print" style={S.btn} onClick={() => download("/admin/reports/audit.csv", "audit.csv")}>⬇ CSV</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={S.th}>When</th><th style={S.th}>Pharmacy</th><th style={S.th}>Action</th><th style={S.th}>Actor</th><th style={S.th}>Diff</th></tr></thead>
            <tbody>
              {(audit ?? []).map((a) => (
                <tr key={a.id}>
                  <td style={S.td}>{new Date(a.createdAt).toLocaleString("en-GB")}</td>
                  <td style={S.td}>{a.pharmacy.name}</td>
                  <td style={S.td}><span style={badge("#e0f2fe", "#0369a1")}>{a.action}</span></td>
                  <td style={S.td} title={a.userId}>{a.userId.startsWith("admin:") ? "super admin" : a.userId.slice(0, 12)}</td>
                  <td style={{ ...S.td, fontSize: 12, color: "#64748b" }}>{JSON.stringify(a.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* block confirmation modal (reason mandatory, audited) */}
      {blockModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ ...S.card, width: 420, marginBottom: 0 }}>
            <h3 style={{ marginTop: 0 }}>🚫 Block “{blockModal.name}”?</h3>
            <p style={{ fontSize: 13, color: "#64748b" }}>
              The pharmacy loses access on next login/refresh (access tokens age out ≤15 min). The action is audited with your reason.
            </p>
            <label style={{ fontSize: 13, color: "#475569" }}>Reason (required)</label>
            <input style={{ ...S.input, margin: "4px 0 10px" }} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. payment overdue / abuse report" />
            <label style={{ fontSize: 13, color: "#475569" }}>Internal note (optional)</label>
            <textarea style={{ ...S.input, margin: "4px 0 14px", minHeight: 60 }} value={blockNote} onChange={(e) => setBlockNote(e.target.value)} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn} onClick={() => { setBlockModal(null); setBlockReason(""); setBlockNote(""); }}>Cancel</button>
              <button
                style={{ ...S.btnDanger, opacity: blockReason.trim().length < 3 ? 0.5 : 1 }}
                disabled={blockReason.trim().length < 3 || busy === blockModal.id}
                onClick={submitBlock}
              >
                Confirm block
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
