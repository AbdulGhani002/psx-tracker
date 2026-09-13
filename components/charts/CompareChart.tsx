"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// The portfolio against the markets, every line indexed to 100 at the start
// of the range: KSE-100, KMI-30, gold in rupees, the dollar, and the world's
// indices in their own currencies. Chips switch lines on and off.

type Key = "portfolioTR" | "portfolio" | "kse100" | "kmi30" | "gold" | "usdpkr" | "sp500" | "ndx100" | "dowjones" | "nikkei225" | "sensex" | "ftse100" | "dax" | "riskFree";
type Point = { date: string } & Partial<Record<Key, number | null>>;
type Data = { range: { from: string; to: string; key: string }; points: Point[]; returns: Partial<Record<Key, number>>; available: Key[] };

const SERIES: Array<{ key: Key; label: string; color: string; dash?: string; on: boolean }> = [
  { key: "portfolioTR", label: "Portfolio", color: "#26a69a", on: true },
  { key: "portfolio", label: "Portfolio (price only)", color: "#94a3b8", dash: "3 3", on: false },
  { key: "kse100", label: "KSE-100", color: "#f59e0b", on: true },
  { key: "kmi30", label: "KMI-30", color: "#16a34a", on: false },
  { key: "gold", label: "Gold (PKR)", color: "#ca8a04", dash: "4 3", on: false },
  { key: "usdpkr", label: "USD/PKR", color: "#64748b", dash: "2 3", on: false },
  { key: "sp500", label: "S&P 500", color: "#3b82f6", on: true },
  { key: "ndx100", label: "NASDAQ 100", color: "#6366f1", on: false },
  { key: "dowjones", label: "Dow Jones", color: "#0ea5e9", on: false },
  { key: "nikkei225", label: "Nikkei 225", color: "#dc2626", on: true },
  { key: "sensex", label: "Sensex", color: "#f97316", on: false },
  { key: "ftse100", label: "FTSE 100", color: "#8b5cf6", on: false },
  { key: "dax", label: "DAX 40", color: "#ec4899", on: false },
  { key: "riskFree", label: "Risk-free (SBP)", color: "#9ca3af", dash: "1 3", on: false },
];
const RANGES = ["3M", "1Y", "3Y", "ALL"] as const;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export function CompareChart({ initialRange = "1Y", height = 320 }: { initialRange?: string; height?: number }) {
  const [range, setRange] = useState<string>(RANGES.includes(initialRange as any) ? initialRange : "1Y");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState<Set<Key>>(new Set(SERIES.filter((s) => s.on).map((s) => s.key)));

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/benchmark?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "fetch failed");
        return r.json() as Promise<Data>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const available = useMemo(() => new Set(data?.available ?? []), [data]);
  const lines = SERIES.filter((s) => on.has(s.key) && available.has(s.key));
  const toggle = (k: Key) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const domain = useMemo(() => {
    if (!data) return ["auto", "auto"] as const;
    let lo = Infinity, hi = -Infinity;
    for (const p of data.points) for (const l of lines) {
      const v = p[l.key];
      if (v != null && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) return ["auto", "auto"] as const;
    const pad = (hi - lo) * 0.06 || 2;
    return [Math.floor(lo - pad), Math.ceil(hi + pad)] as const;
  }, [data, lines]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {SERIES.map((s) => {
            const has = available.has(s.key);
            const active = on.has(s.key) && has;
            const r = data?.returns[s.key];
            return (
              <button
                key={s.key}
                type="button"
                disabled={!has}
                onClick={() => toggle(s.key)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] border transition-colors disabled:opacity-30"
                style={{ borderColor: active ? s.color : "var(--rule)", background: active ? `color-mix(in srgb, ${s.color} 10%, white)` : "var(--surface)", color: active ? "var(--ink)" : "var(--muted)" }}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: active ? s.color : "var(--rule-strong)" }} />
                {s.label}
                {r != null && <span className="mono-num font-medium" style={{ color: r >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(r)}</span>}
              </button>
            );
          })}
        </div>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r} type="button" data-active={range === r} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="mt-3" style={{ height }}>
        {!data && !error ? (
          <div className="skeleton h-full" />
        ) : error ? (
          <div className="text-[12px] text-muted h-full flex items-center justify-center">No series yet ({error}).</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data!.points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v: string) => { const d = new Date(v); return d.toLocaleDateString("en-US", { month: "short", day: range === "3M" ? "numeric" : undefined, year: range === "ALL" || range === "3Y" ? "2-digit" : undefined }); }} tick={{ fill: "#6b7280", fontSize: 10.5 }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} minTickGap={40} />
              <YAxis domain={domain as any} tickFormatter={(v: number) => v.toFixed(0)} tick={{ fill: "#6b7280", fontSize: 10.5 }} tickLine={false} axisLine={false} width={34} />
              <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 14px rgba(15,23,42,.08)" }}
                labelStyle={{ color: "#6b7280", fontSize: 11, marginBottom: 4 }}
                formatter={(v: number, name: string) => [`${(v - 100 >= 0 ? "+" : "") + (v - 100).toFixed(2)}%`, name]}
                labelFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
              />
              {lines.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.key === "portfolioTR" ? 2.4 : 1.6} strokeDasharray={s.dash} dot={false} activeDot={{ r: 3 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      {data && <div className="text-[11px] mt-2" style={{ color: "var(--faint)" }}>Indexed to 100 on {new Date(data.range.from).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}. Foreign indices in their own currency.</div>}
    </div>
  );
}
