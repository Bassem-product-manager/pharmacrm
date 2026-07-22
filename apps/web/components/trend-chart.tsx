"use client";

import { arDigits } from "@/lib/format";

interface TrendPoint {
  date: string;
  salesCount: number;
  salesEgp: number;
}

/**
 * Hand-rolled SVG area + line chart for the daily sales trend (no chart lib).
 * Rendered LTR (time flows left→right, the universal convention) even inside
 * the RTL app; all numbers use Arabic-Indic digits.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const W = 720;
  const H = 240;
  const padX = 32;
  const padY = 24;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const max = Math.max(1, ...data.map((d) => d.salesEgp));
  const n = data.length;
  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padY + innerH - (v / max) * innerH;

  const pts = data.map((d, i) => [x(i), y(d.salesEgp)] as const);
  const linePath = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const areaPath =
    pts.length > 0
      ? `${linePath} L${pts[pts.length - 1]![0].toFixed(1)},${padY + innerH} L${pts[0]![0].toFixed(1)},${padY + innerH} Z`
      : "";

  // show ~5 evenly-spaced date labels
  const labelEvery = Math.max(1, Math.ceil(n / 5));
  const shortDate = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${arDigits(Number(d))}/${arDigits(Number(m))}`;
  };

  return (
    <div dir="ltr" className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label="اتجاه المبيعات">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* horizontal gridlines */}
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={padX} x2={W - padX} y1={padY + innerH * t} y2={padY + innerH * t} stroke="rgb(226 232 240)" strokeWidth="1" />
        ))}

        {areaPath && <path d={areaPath} fill="url(#trendFill)" />}
        {linePath && <path d={linePath} fill="none" stroke="rgb(5 150 105)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}

        {pts.map(([px, py], i) => (
          <g key={i}>
            <circle cx={px} cy={py} r="3.5" fill="white" stroke="rgb(5 150 105)" strokeWidth="2" />
            <title>{`${shortDate(data[i]!.date)} — ${arDigits(Math.round(data[i]!.salesEgp))} ج.م · ${arDigits(data[i]!.salesCount)} عملية`}</title>
          </g>
        ))}

        {/* max value label */}
        <text x={padX} y={padY - 8} fill="rgb(148 163 184)" fontSize="12">{`${arDigits(Math.round(max))} ج.م`}</text>

        {/* x-axis date labels */}
        {data.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={d.date} x={x(i)} y={H - 4} fill="rgb(148 163 184)" fontSize="11" textAnchor="middle">
              {shortDate(d.date)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
