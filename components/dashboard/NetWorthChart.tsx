"use client";

import { useEffect, useMemo, useState } from "react";
import { ValueChart, type ValuePoint } from "@/components/charts/ValueChart";

// The value line with the money put in dashed under it, over a range picked
// from the segmented control. Figures come from the server; the series is
// fetched here so the page never waits on it. In dollars, each day's value is
// at that day's USD/PKR rate and the dashed line is every buy and sale at its
// own day's rate, so the gap between them is the return a dollar holder had.

type Point = { date: string; portfolioValue: number; invested?: number; kse100: number | null; usdRate?: number | null; valueUsd?: number | null; investedUsd?: number | null };
type Data = { points: Point[]; returns: Partial<Record<string, number>> };
type Ccy = "PKR" | "USD";

const RANGES = ["1M", "3M", "1Y", "3Y", "ALL"] as const;
const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;
const short = (v: number) => (Math.abs(v) >= 1e7 ? `Rs ${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e5 ? `Rs ${(v / 1e3).toFixed(0)}k` : rs(v));
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const shortUsd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${(v / 1e3).toFixed(1)}k` : usd(v));
const CCY_KEY = "networth-chart-ccy";

export function NetWorthChart({ title = "Market value", value, height = 240, samplePoints, defaultRange = "1Y", usdRate }: { title?: string; value: number; height?: number; samplePoints?: ValuePoint[]; defaultRange?: string; usdRate?: number | null }) {
  const [range, setRange] = useState<string>(defaultRange);
  const [ccy, setCcy] = useState<Ccy>("PKR");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(CCY_KEY) === "USD") setCcy("USD");
    } catch {
      /* no storage: rupees */
    }
  }, []);
  const pickCcy = (c: Ccy) => {
    setCcy(c);
    try {
      localStorage.setItem(CCY_KEY, c);
    } catch {
      /* the choice just is not remembered */
    }
  };

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

  const hasUsd = !samplePoints && !!data && data.points.some((p) => p.valueUsd != null && p.valueUsd > 0);
  const inUsd = ccy === "USD" && hasUsd;
  const lastRate = usdRate ?? [...(data?.points ?? [])].reverse().find((p) => p.usdRate)?.usdRate ?? null;

  const points: ValuePoint[] = useMemo(() => {
    if (samplePoints) return samplePoints;
    if (!data) return [];
    if (inUsd) return data.points.map((p) => ({ date: p.date, value: p.valueUsd && p.valueUsd > 0 ? p.valueUsd : null, bench: p.investedUsd && p.investedUsd > 0 ? p.investedUsd : null }));
    return data.points.map((p) => ({ date: p.date, value: p.portfolioValue > 0 ? p.portfolioValue : null, bench: p.invested && p.invested > 0 ? p.invested : null }));
  }, [data, samplePoints, inUsd]);

  return (
    <div className="card card-pad h-full">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[12px] text-muted">{title}</div>
          <div className="fig text-[18px] mt-0.5">
            {inUsd && lastRate ? usd(value / lastRate) : rs(value)}
            {inUsd && lastRate && <span className="text-[11.5px] text-muted font-normal ml-2">at Rs {lastRate.toFixed(2)} a dollar</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasUsd && (
            <div className="seg" role="group" aria-label="Currency">
              <button type="button" data-active={!inUsd} onClick={() => pickCcy("PKR")}>Rs</button>
              <button type="button" data-active={inUsd} onClick={() => pickCcy("USD")}>$</button>
            </div>
          )}
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} type="button" data-active={range === r} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {points.length === 0 && !error ? (
          <div className="skeleton" style={{ height }} />
        ) : error && points.length === 0 ? (
          <div className="text-[12px] text-muted flex items-center justify-center" style={{ height }}>No series yet ({error}).</div>
        ) : (
          <ValueChart points={points} height={height} format={inUsd ? shortUsd : short} valueLabel={inUsd ? "Market value in $" : "Market value"} benchLabel={inUsd ? "Invested in $ (each day's rate)" : "Invested"} color="var(--teal)" benchColor="var(--blue)" />
        )}
      </div>
    </div>
  );
}
