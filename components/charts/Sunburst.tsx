"use client";

import { useState } from "react";

// Zar's holdings wheel: sectors on the inner ring, the names on the outer,
// each name coloured green or red by how far it sits from your cost. The
// centre shows the figure of the day. Plain SVG, hover reveals the numbers.

export type SunburstLeaf = { symbol: string; sector: string; value: number; pct: number; changePct?: number | null };

const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;

function tone(pct: number): string {
  // pct is the unrealised gain as a fraction; saturate at 30%
  const a = Math.min(1, Math.abs(pct) / 0.3);
  return pct >= 0 ? `color-mix(in srgb, #16a34a ${Math.round(35 + a * 65)}%, #dcfce7)` : `color-mix(in srgb, #dc2626 ${Math.round(35 + a * 65)}%, #fee2e2)`;
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${big} 0 ${x3},${y3} Z`;
}

export function Sunburst({ leaves, centreLabel, centreValue, centreTone, size = 260 }: { leaves: SunburstLeaf[]; centreLabel: string; centreValue: string; centreTone?: string; size?: number }) {
  const [hover, setHover] = useState<{ label: string; sub: string } | null>(null);
  const total = leaves.reduce((s, l) => s + l.value, 0);
  if (total <= 0) return <div className="text-[12px] text-muted">Nothing to draw yet.</div>;
  const sectors = new Map<string, SunburstLeaf[]>();
  for (const l of leaves) (sectors.get(l.sector || "Other") ?? sectors.set(l.sector || "Other", []).get(l.sector || "Other")!).push(l);
  const groups = [...sectors.entries()].map(([sector, items]) => ({ sector, items: items.sort((a, b) => b.value - a.value), value: items.reduce((s, x) => s + x.value, 0) })).sort((a, b) => b.value - a.value);
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 2;
  const gap = 0.012;
  let a = -Math.PI / 2;
  const outer: JSX.Element[] = [];
  const inner: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  for (const g of groups) {
    const span = (g.value / total) * Math.PI * 2;
    const a0 = a, a1 = a + span;
    inner.push(
      <path key={`s-${g.sector}`} d={arc(cx, cy, R * 0.42, R * 0.6, a0 + gap / 2, Math.max(a0 + gap / 2, a1 - gap / 2))} fill="#e5e7eb" stroke="#fff" strokeWidth={1} onMouseEnter={() => setHover({ label: g.sector, sub: `${((g.value / total) * 100).toFixed(1)}% · ${rs(g.value)}` })} onMouseLeave={() => setHover(null)} />
    );
    if (span > 0.35) {
      const mid = (a0 + a1) / 2, r = R * 0.51;
      labels.push(<text key={`t-${g.sector}`} x={cx + r * Math.cos(mid)} y={cy + r * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fontSize={8.5} fill="#475569" style={{ pointerEvents: "none" }}>{g.sector.length > 12 ? g.sector.slice(0, 11) + "…" : g.sector}</text>);
    }
    let b = a0;
    for (const l of g.items) {
      const ls = (l.value / total) * Math.PI * 2;
      const b0 = b, b1 = b + ls;
      outer.push(
        <path key={l.symbol} d={arc(cx, cy, R * 0.62, R, b0 + gap / 2, Math.max(b0 + gap / 2, b1 - gap / 2))} fill={tone(l.pct)} stroke="#fff" strokeWidth={1} onMouseEnter={() => setHover({ label: l.symbol, sub: `${((l.value / total) * 100).toFixed(1)}% · ${rs(l.value)} · ${l.pct >= 0 ? "+" : ""}${(l.pct * 100).toFixed(1)}% on cost` })} onMouseLeave={() => setHover(null)} />
      );
      if (ls > 0.22) {
        const mid = (b0 + b1) / 2, r = R * 0.81;
        labels.push(<text key={`l-${l.symbol}`} x={cx + r * Math.cos(mid)} y={cy + r * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#fff" style={{ pointerEvents: "none" }}>{l.symbol}</text>);
      }
      b = b1;
    }
    a = a1;
  }
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {inner}
        {outer}
        {labels}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={15} fontWeight={600} fill={hover ? "#0f172a" : centreTone ?? "#0f172a"}>{hover ? hover.label : centreValue}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9.5} fill="#6b7280">{hover ? hover.sub : centreLabel}</text>
      </svg>
      <div className="flex items-center gap-2 text-[10.5px] text-muted mt-1">
        <span>Loss</span>
        {[-0.3, -0.15, -0.05, 0.05, 0.15, 0.3].map((p) => <span key={p} className="inline-block w-4 h-2 rounded-sm" style={{ background: tone(p) }} />)}
        <span>Gain</span>
      </div>
    </div>
  );
}
