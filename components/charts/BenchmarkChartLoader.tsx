"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { BenchmarkChart, type BenchmarkPoint } from "./BenchmarkChart";
import { SERIES_META, SERIES_ORDER, type SeriesKey } from "./series-meta";
import { fmtSignedPct } from "@/lib/format";

type Data = {
  range: { from: string; to: string; key: string };
  points: BenchmarkPoint[];
  returns: Partial<Record<SeriesKey, number>>;
  available: SeriesKey[];
};

const RANGES = ["90D", "1Y", "ALL"] as const;

export function BenchmarkChartLoader() {
  const [rangeKey, setRangeKey] = useState<string>("90D");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<SeriesKey>>(
    new Set(SERIES_ORDER.filter((k) => SERIES_META[k].defaultOn))
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/benchmark?range=${rangeKey}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error ?? "fetch_failed");
        }
        return r.json() as Promise<Data>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  function toggle(key: SeriesKey) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const availableSet = useMemo(
    () => new Set(data?.available ?? []),
    [data]
  );

  const visibleList = SERIES_ORDER.filter(
    (k) => visible.has(k) && availableSet.has(k)
  );

  const kseReturn = data?.returns.kse100;

  return (
    <div className="space-y-4">
      {/* range selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRangeKey(r)}
              className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-button border transition-colors"
              style={{
                borderColor: rangeKey === r ? "var(--ink)" : "var(--rule)",
                background: rangeKey === r ? "var(--ink)" : "transparent",
                color: rangeKey === r ? "var(--paper)" : "var(--muted)",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-[11px] text-muted font-mono">
            {data.range.from} → {data.range.to}
          </span>
        )}
      </div>

      {/* series toggle chips */}
      <div className="flex flex-wrap gap-2">
        {SERIES_ORDER.map((key) => {
          const m = SERIES_META[key];
          const isAvailable = availableSet.has(key);
          const isOn = visible.has(key) && isAvailable;
          return (
            <button
              key={key}
              onClick={() => isAvailable && toggle(key)}
              disabled={!isAvailable}
              title={isAvailable ? m.hint : "No data for this range"}
              className="flex items-center gap-2 px-2.5 py-1 border text-[11px] font-mono transition-colors disabled:opacity-30"
              style={{
                borderColor: isOn ? "var(--ink)" : "var(--rule)",
                background: isOn ? "var(--paper-2)" : "transparent",
              }}
            >
              <span
                className="inline-block w-3 h-[2px]"
                style={{
                  background: isOn ? m.stroke : "var(--rule)",
                  borderTop: m.dash ? `2px dashed ${isOn ? m.stroke : "var(--rule)"}` : undefined,
                }}
                aria-hidden
              />
              <span style={{ color: isOn ? "var(--ink)" : "var(--muted)" }}>{m.short}</span>
              {isAvailable && data?.returns[key] != null && (
                <span
                  className="mono-num"
                  style={{
                    color:
                      (data.returns[key] ?? 0) >= 0 ? "var(--positive)" : "var(--negative)",
                  }}
                >
                  {fmtSignedPct(data.returns[key] ?? 0, 1)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <Card>
          <p className="text-sm text-muted">Loading {rangeKey} benchmark…</p>
        </Card>
      )}

      {!loading && (error || !data) && (
        <Card>
          <p className="text-sm text-muted">
            Benchmark unavailable.{" "}
            {error === "no_data"
              ? "Add transactions to compare your portfolio against the market."
              : "The data sources didn't respond — try again shortly."}
          </p>
        </Card>
      )}

      {!loading && data && (
        <>
          {/* headline cards: portfolio + alpha vs KSE */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["portfolio", "kse100", "portfolioUsd", "sp500"] as SeriesKey[])
              .filter((k) => availableSet.has(k))
              .map((k) => {
                const r = data.returns[k] ?? 0;
                const isAlpha = false;
                return (
                  <Card key={k}>
                    <div className="label-cap">{SERIES_META[k].short}</div>
                    <div
                      className="font-display mono-num text-[22px] mt-1"
                      style={{
                        fontVariationSettings: "'opsz' 144",
                        color: r >= 0 ? "var(--positive)" : "var(--negative)",
                      }}
                    >
                      {fmtSignedPct(r, 2)}
                    </div>
                    {k === "portfolio" && kseReturn != null && (
                      <div className="text-[11px] text-muted font-mono mt-1">
                        alpha {fmtSignedPct((data.returns.portfolio ?? 0) - kseReturn, 2)}
                      </div>
                    )}
                  </Card>
                );
              })}
          </div>

          <BenchmarkChart points={data.points} visible={visibleList} />
          <p className="text-[11px] text-muted font-mono">
            All series indexed to 100 at {data.range.from}. USD/PKR &amp; S&amp;P 500 via Yahoo;
            KSE-100 &amp; KMI-30 via PSX; risk-free compounds the SBP policy rate.
          </p>
        </>
      )}
    </div>
  );
}
