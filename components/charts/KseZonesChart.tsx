"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// A year of the KSE-100 with its 200-day average, the 52-week high, and the
// strategy's buy zones shaded across the chart, deeper ones darker, each
// numbered at the right. Hover reads a day. Sized to its container, like
// ValueChart.

export type ZonePoint = { date: string; close: number; ma200: number | null };
export type ChartZone = { n: number; low: number; high: number; due: boolean };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(260, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    setW(Math.max(260, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function KseZonesChart({ points, zones, high, height = 300 }: { points: ZonePoint[]; zones: ChartZone[]; high: number | null; height?: number }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 58, r: 26, t: 10, b: 26 };
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = [...points.map((p) => p.close), ...points.map((p) => p.ma200).filter((v): v is number => v != null), ...zones.flatMap((z) => [z.low, z.high]), ...(high ? [high] : [])];
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || hi * 0.05;
    lo -= span * 0.04;
    hi += span * 0.04;
    const plotW = w - pad.l - pad.r, plotH = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (i / (points.length - 1)) * plotW;
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * plotH;
    const path = (get: (p: ZonePoint) => number | null) => {
      let d = "", on = false;
      points.forEach((p, i) => {
        const v = get(p);
        if (v == null) {
          on = false;
          return;
        }
        d += `${on ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        on = true;
      });
      return d;
    };
    const monthIdx: number[] = [];
    for (let i = 1; i < points.length; i++) if (points[i].date.slice(0, 7) !== points[i - 1].date.slice(0, 7)) monthIdx.push(i);
    const every = Math.max(1, Math.ceil(monthIdx.length / Math.max(1, Math.floor(plotW / 64))));
    return { x, y, line: path((p) => p.close), ma: path((p) => p.ma200), ticks: niceTicks(lo, hi, 4), labels: monthIdx.filter((_, k) => k % every === 0), plotW, plotH };
  }, [points, zones, high, w, height, pad.l, pad.r, pad.t, pad.b]);

  if (!geo) return <div ref={ref} className="text-[12px] text-muted" style={{ height }}>Not enough history to draw.</div>;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / geo.plotW) * (points.length - 1)))));
  };
  const hp = hover != null ? points[hover] : null;
  const last = points[points.length - 1];
  const deepest = Math.max(1, ...zones.map((z) => z.n));

  return (
    <div ref={ref} className="relative">
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block" }} role="img" aria-label={`KSE-100 at ${fmt(last.close)}; buy zones ${zones.map((z) => `${fmt(z.low)} to ${fmt(z.high)}`).join(", ")}`}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--rule)" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={geo.y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-mono)">{fmt(t)}</text>
          </g>
        ))}
        {zones.map((z) => (
          <g key={z.n}>
            <rect x={pad.l} width={geo.plotW} y={geo.y(z.high)} height={Math.max(2, geo.y(z.low) - geo.y(z.high))} fill="var(--positive)" opacity={0.1 + (0.14 * z.n) / deepest} />
            <line x1={pad.l} x2={w - pad.r} y1={geo.y(z.high)} y2={geo.y(z.high)} stroke="var(--positive)" strokeOpacity="0.55" strokeDasharray={z.due ? undefined : "3 3"} />
            <text x={w - pad.r + 6} y={(geo.y(z.high) + geo.y(z.low)) / 2 + 4} fontSize="11" fontWeight="700" fill="var(--positive)">{z.n}</text>
          </g>
        ))}
        {high != null && (
          <g>
            <line x1={pad.l} x2={w - pad.r} y1={geo.y(high)} y2={geo.y(high)} stroke="var(--muted)" strokeDasharray="1 3" />
            <text x={pad.l + 4} y={geo.y(high) - 4} fontSize="10.5" fill="var(--muted)">52-week high {fmt(high)}</text>
          </g>
        )}
        <path d={geo.ma} fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="5 4" />
        <path d={geo.line} fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={geo.x(points.length - 1)} cy={geo.y(last.close)} r="4" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
        {geo.labels.map((i) => (
          <text key={i} x={geo.x(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
            {(() => {
              const d = points[i].date, m = MONTHS[Number(d.slice(5, 7)) - 1];
              return m === "Jan" ? `${m} ${d.slice(2, 4)}` : m;
            })()}
          </text>
        ))}
        {hp && hover != null && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.t} y2={pad.t + geo.plotH} stroke="var(--rule-strong)" />
            <circle cx={geo.x(hover)} cy={geo.y(hp.close)} r="4" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && hover != null && (
        <div className="absolute pointer-events-none card px-3 py-2 text-[12px]" style={{ left: Math.min(w - 170, Math.max(0, geo.x(hover) + 10)), top: 6, minWidth: 150 }}>
          <div className="text-muted mb-1">{hp.date}</div>
          <div className="flex justify-between gap-4"><span>KSE-100</span><span className="font-mono mono-num">{fmt(hp.close)}</span></div>
          {hp.ma200 != null && <div className="flex justify-between gap-4"><span style={{ color: "var(--amber)" }}>200-day</span><span className="font-mono mono-num">{fmt(hp.ma200)}</span></div>}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: "var(--ink)" }} />KSE-100</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 border-t border-dashed" style={{ borderColor: "var(--amber)" }} />200-day average</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 h-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--positive) 22%, transparent)" }} />Buy zones</span>
      </div>
    </div>
  );
}
