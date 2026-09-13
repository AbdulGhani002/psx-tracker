"use client";

import { useEffect, useMemo, useState } from "react";
import { ValueChart, type ValuePoint } from "@/components/charts/ValueChart";

// The value line with the money put in dashed under it, over a range picked
// from the segmented control. Figures come from the server; the series is
// fetched here so the page never waits on it.

type Point = { date: string; portfolioValue: number; invested?: number; kse100: number | null };
type Data = { points: Point[]; returns: Partial<Record<string, number>> };

const RANGES = ["1M", "3M", "1Y", "3Y", "ALL"] as const;
const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;
const short = (v: number) => (Math.abs(v) >= 1e7 ? `Rs ${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e5 ? `Rs ${(v / 1e3).toFixed(0)}k` : rs(v));

export function NetWorthChart({ title = "Market value", value, height = 240, samplePoints, defaultRange = "1Y" }: { title?: string; value: number; height?: number; samplePoints?: ValuePoint[]; defaultRange?: string }) {
  const [range, setRange] = useState<string>(defaultRange);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (samplePoints) return;
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
  }, [range, samplePoints]);

  const points: ValuePoint[] = useMemo(() => {
    if (samplePoints) return samplePoints;
    if (!data) return [];
    return data.points.map((p) => ({ date: p.date, value: p.portfolioValue > 0 ? p.portfolioValue : null, bench: p.invested && p.invested > 0 ? p.invested : null }));
  }, [data, samplePoints]);

  return (
    <div className="card card-pad h-full">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] text-muted">{title}</div>
          <div className="fig text-[18px] mt-0.5">{rs(value)}</div>
        </div>
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r} type="button" data-active={range === r} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        {points.length === 0 && !error ? (
          <div className="skeleton" style={{ height }} />
        ) : error && points.length === 0 ? (
          <div className="text-[12px] text-muted flex items-center justify-center" style={{ height }}>No series yet ({error}).</div>
        ) : (
          <ValueChart points={points} height={height} format={short} valueLabel="Market value" benchLabel="Invested" color="var(--teal)" benchColor="var(--blue)" />
        )}
      </div>
    </div>
  );
}
