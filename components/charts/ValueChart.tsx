"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// A value line with a soft fill under it, an optional dashed comparison line,
// and a crosshair with a tooltip on hover. Sized to its container; text stays
// crisp because the SVG is drawn at pixel size, not stretched.

export type ValuePoint = { date: string; value: number | null; bench?: number | null };

type Props = {
  points: ValuePoint[];
  height?: number;
  format: (v: number) => string;
  valueLabel?: string;
  benchLabel?: string;
  color?: string;
  benchColor?: string;
  baseline?: number | null; // a horizontal reference (e.g. the start value)
  className?: string;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(200, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    setW(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ValueChart({ points, height = 260, format, valueLabel = "Value", benchLabel = "KSE-100", color = "var(--accent)", benchColor = "var(--blue)", baseline = null, className = "" }: Props) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const pts = useMemo(() => points.filter((p) => p.value != null && Number.isFinite(p.value)), [points]);
  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const vals = pts.map((p) => p.value as number);
    const bench = pts.map((p) => p.bench).filter((v): v is number => v != null && Number.isFinite(v));
    let lo = Math.min(...vals, ...bench, ...(baseline != null ? [baseline] : []));
    let hi = Math.max(...vals, ...bench, ...(baseline != null ? [baseline] : []));
    const span = hi - lo || hi * 0.05 || 1;
    lo -= span * 0.06;
    hi += span * 0.06;
    const plotW = w - pad.l - pad.r, plotH = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (i / (pts.length - 1)) * plotW;
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * plotH;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value as number).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${(pad.t + plotH).toFixed(1)} L${x(0).toFixed(1)},${(pad.t + plotH).toFixed(1)} Z`;
    let benchLine = "";
    let started = false;
    pts.forEach((p, i) => {
      if (p.bench == null || !Number.isFinite(p.bench)) return;
      benchLine += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(p.bench).toFixed(1)} `;
      started = true;
    });
    const ticks = niceTicks(lo, hi, 4);
    const monthIdx: number[] = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].date.slice(0, 7) !== pts[i - 1].date.slice(0, 7)) monthIdx.push(i);
    const every = Math.max(1, Math.ceil(monthIdx.length / Math.max(1, Math.floor(plotW / 70))));
    const labels = monthIdx.filter((_, k) => k % every === 0);
    return { x, y, line, area, benchLine, ticks, labels, plotH, plotW };
  }, [pts, w, height, baseline, pad.l, pad.r, pad.t, pad.b]);

  if (!geo) return <div ref={ref} className={`text-[12px] text-muted ${className}`} style={{ height }}>Not enough history to draw.</div>;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.l) / geo.plotW) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };
  const hp = hover != null ? pts[hover] : null;
  const gid = `grad-${valueLabel.replace(/\W+/g, "")}`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--rule)" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={geo.y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-mono)">
              {format(t)}
            </text>
          </g>
        ))}
        {baseline != null && <line x1={pad.l} x2={w - pad.r} y1={geo.y(baseline)} y2={geo.y(baseline)} stroke="var(--rule-strong)" strokeDasharray="4 4" />}
        <path d={geo.area} fill={`url(#${gid})`} />
        {geo.benchLine && <path d={geo.benchLine} fill="none" stroke={benchColor} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.9" />}
        <path d={geo.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {geo.labels.map((i) => (
          <text key={i} x={geo.x(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
            {(() => {
              const d = pts[i].date;
              const m = MONTHS[Number(d.slice(5, 7)) - 1];
              return m === "Jan" ? `${m} ${d.slice(2, 4)}` : m;
            })()}
          </text>
        ))}
        {hp && hover != null && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={pad.t} y2={pad.t + geo.plotH} stroke="var(--rule-strong)" />
            <circle cx={geo.x(hover)} cy={geo.y(hp.value as number)} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
            {hp.bench != null && <circle cx={geo.x(hover)} cy={geo.y(hp.bench)} r="3.5" fill={benchColor} stroke="var(--surface)" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {hp && hover != null && (
        <div
          className="absolute pointer-events-none card px-3 py-2 text-[12px]"
          style={{ left: Math.min(w - 190, Math.max(0, geo.x(hover) + 10)), top: 6, minWidth: 170 }}
        >
          <div className="text-muted mb-1">{hp.date}</div>
          <div className="flex justify-between gap-4">
            <span style={{ color }}>{valueLabel}</span>
            <span className="font-mono mono-num">{format(hp.value as number)}</span>
          </div>
          {hp.bench != null && (
            <div className="flex justify-between gap-4">
              <span style={{ color: benchColor }}>{benchLabel}</span>
              <span className="font-mono mono-num">{format(hp.bench)}</span>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-4 mt-2 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: color }} /> {valueLabel}</span>
        {geo.benchLine && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 border-t border-dashed" style={{ borderColor: benchColor }} /> {benchLabel}</span>}
      </div>
    </div>
  );
}
