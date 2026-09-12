"use client";

import { useEffect, useMemo, useState } from "react";
import { ValueChart, type ValuePoint } from "./ValueChart";

// The overview's main chart: the portfolio's value with the KSE-100 laid
// over it at the same starting point, period tabs, and the two returns as
// pills. Fetches the benchmark series for the chosen range from the API the
// Wealth page already uses.

type Point = { date: string; portfolioValue: number; portfolio: number | null; portfolioTR: number | null; netWorth: number | null; kse100: number | null };
type Data = { range: { from: string; to: string; key: string }; points: Point[]; returns: Partial<Record<string, number>>; stale?: boolean };

const RANGES = ["1M", "3M", "1Y", "3Y", "ALL"] as const;
type Mode = "value" | "return";

const fmtRs = (v: number) => (Math.abs(v) >= 1e7 ? `Rs ${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e5 ? `Rs ${(v / 1e3).toFixed(0)}k` : `Rs ${Math.round(v).toLocaleString("en-US")}`);
const fmtIdx = (v: number) => `${(v - 100 >= 0 ? "+" : "") + (v - 100).toFixed(1)}%`;

export function PerformancePanel({ initialRange = "1Y", netWorthNow }: { initialRange?: string; netWorthNow?: number }) {
  const [range, setRange] = useState<string>(initialRange);
  const [mode, setMode] = useState<Mode>("value");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/benchmark?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "fetch failed");
        return r.json() as Promise<Data>;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const points: ValuePoint[] = useMemo(() => {
    if (!data) return [];
    const pts = data.points;
    if (mode === "return") return pts.map((p) => ({ date: p.date, value: p.portfolio, bench: p.kse100 }));
    // The benchmark is scaled to start where the portfolio's value starts, so
    // the gap between the lines is the gap in performance, not in size.
    const first = pts.find((p) => p.portfolioValue > 0);
    const startValue = first?.portfolioValue ?? 0;
    const startBench = first?.kse100 ?? null;
    return pts.map((p) => ({ date: p.date, value: p.portfolioValue > 0 ? p.portfolioValue : null, bench: startBench && p.kse100 != null ? (p.kse100 / startBench) * startValue : null }));
  }, [data, mode]);

  const portRet = data?.returns?.portfolio;
  const benchRet = data?.returns?.kse100;
  const pill = (label: string, r: number | undefined) =>
    r == null ? null : (
      <span className="pill" data-tone={r >= 0 ? "positive" : "negative"}>
        {label} {r >= 0 ? "+" : ""}{(r * 100).toFixed(1)}%
      </span>
    );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {pill("Portfolio", portRet)}
          {pill("KSE-100", benchRet)}
          {data?.stale && <span className="pill" data-tone="muted">last good copy</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="seg">
            <button type="button" data-active={mode === "value"} onClick={() => setMode("value")}>Value</button>
            <button type="button" data-active={mode === "return"} onClick={() => setMode("return")}>Return</button>
          </div>
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} type="button" data-active={range === r} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
      {loading && !data ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : error && !data ? (
        <div className="text-[12px] text-muted" style={{ height: 260 }}>
          No series yet ({error}). It is built from the pushed price history; try again in a minute.
        </div>
      ) : (
        <ValueChart points={points} height={260} format={mode === "value" ? fmtRs : fmtIdx} valueLabel={mode === "value" ? "Portfolio value" : "Portfolio return"} benchLabel="KSE-100" baseline={mode === "return" ? 100 : null} />
      )}
      {netWorthNow != null && mode === "value" && <div className="text-[11px] text-muted mt-1">The value line is the equities only (what the price history covers); net worth today, with funds and savings, is {fmtRs(netWorthNow)}.</div>}
    </div>
  );
}
