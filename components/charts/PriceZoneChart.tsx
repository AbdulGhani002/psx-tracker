import { fmtRs } from "@/lib/format";

const ZONE = {
  strongBuy: "#4f7a4a",
  buy: "#8fa07f",
  fair: "#d4a574",
  expensive: "#c87b68",
};

// One year of the share price drawn over the four buying-zone bands. Because a
// LOWER price is a better buy, the green (strong-buy) band sits at the bottom
// and red (expensive) at the top — so you can literally see every stretch where
// the price dipped into a buying zone, and where it sits now.
export function PriceZoneChart({
  history,
  strongBuyBelow,
  buyBelow,
  fairUpTo,
  intrinsic,
}: {
  history: { date: string; close: number }[];
  strongBuyBelow: number | null;
  buyBelow: number | null;
  fairUpTo: number | null;
  intrinsic: number | null;
}) {
  if (history.length < 5 || strongBuyBelow == null || buyBelow == null || fairUpTo == null || intrinsic == null) return null;

  const closes = history.map((p) => p.close);
  const yLo = Math.min(...closes, strongBuyBelow) * 0.96;
  const yHi = Math.max(...closes, fairUpTo) * 1.04;
  const ySpan = yHi - yLo || 1;

  const W = 720;
  const H = 240;
  const L = 46;
  const Rg = 10;
  const T = 10;
  const B = 22;
  const plotW = W - L - Rg;
  const plotH = H - T - B;

  const x = (i: number) => L + (i / (history.length - 1)) * plotW;
  const y = (v: number) => T + (1 - (v - yLo) / ySpan) * plotH;

  // Zone bands (top = expensive, bottom = strong buy). Each band spans its price range.
  const bands = [
    { from: yLo, to: strongBuyBelow, color: ZONE.strongBuy },
    { from: strongBuyBelow, to: buyBelow, color: ZONE.buy },
    { from: buyBelow, to: fairUpTo, color: ZONE.fair },
    { from: fairUpTo, to: yHi, color: ZONE.expensive },
  ];

  const path = history.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(" ");
  const last = history[history.length - 1];
  const lastY = y(last.close);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price history with buying zones">
      {bands.map((b, i) => {
        const yTop = y(b.to);
        const h = Math.max(0, y(b.from) - y(b.to));
        return <rect key={i} x={L} y={yTop} width={plotW} height={h} fill={b.color} opacity={0.16} />;
      })}

      {/* zone threshold lines + right labels */}
      {[
        { v: strongBuyBelow, label: "Strong buy", color: ZONE.strongBuy },
        { v: buyBelow, label: "Buy", color: ZONE.buy },
        { v: fairUpTo, label: "Fair", color: ZONE.fair },
      ].map((z) => (
        <g key={z.label}>
          <line x1={L} y1={y(z.v)} x2={L + plotW} y2={y(z.v)} stroke={z.color} strokeWidth="1" strokeDasharray="2 3" opacity={0.7} />
          <text x={L + 4} y={y(z.v) - 3} fontSize="9" fill={z.color} className="font-mono">
            {z.label} {fmtRs(z.v, true)}
          </text>
        </g>
      ))}

      {/* intrinsic line */}
      <line x1={L} y1={y(intrinsic)} x2={L + plotW} y2={y(intrinsic)} stroke="var(--accent-deep)" strokeWidth="1.5" />

      {/* price path */}
      <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <circle cx={x(history.length - 1)} cy={lastY} r="3" fill="var(--ink)" />

      {/* y axis ends */}
      <text x={L - 6} y={y(yHi) + 9} textAnchor="end" fontSize="9" fill="var(--muted)" className="font-mono">{fmtRs(yHi, true)}</text>
      <text x={L - 6} y={y(yLo)} textAnchor="end" fontSize="9" fill="var(--muted)" className="font-mono">{fmtRs(yLo, true)}</text>
      <text x={L} y={H - 7} fontSize="9" fill="var(--muted)" className="font-mono">{history[0].date}</text>
      <text x={L + plotW} y={H - 7} textAnchor="end" fontSize="9" fill="var(--muted)" className="font-mono">{last.date}</text>
    </svg>
  );
}
