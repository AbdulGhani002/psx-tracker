"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { BenchmarkChart, type BenchmarkPoint } from "./BenchmarkChart";
import { fmtPct } from "@/lib/format";

type Data = {
  range: { from: string; to: string };
  points: BenchmarkPoint[];
  portfolioStart: number;
  portfolioEnd: number;
  kseStart: number;
  kseEnd: number;
};

export function BenchmarkChartLoader() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/benchmark?days=90")
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error ?? "fetch_failed");
        }
        return r.json() as Promise<Data>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-muted">Loading 90-day benchmark…</p>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card>
        <p className="text-sm text-muted">
          Benchmark unavailable right now. {error === "no_data" ? "Add transactions to see your portfolio vs. KSE-100." : ""}
        </p>
      </Card>
    );
  }

  const portfolioReturn = data.portfolioStart > 0 ? data.portfolioEnd / data.portfolioStart - 1 : 0;
  const kseReturn = data.kseStart > 0 ? data.kseEnd / data.kseStart - 1 : 0;
  const alpha = portfolioReturn - kseReturn;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="label-cap">Your portfolio</div>
          <div
            className="font-display mono-num text-[22px] mt-1"
            style={{
              fontVariationSettings: "'opsz' 144",
              color: portfolioReturn >= 0 ? "var(--positive)" : "var(--negative)",
            }}
          >
            {portfolioReturn >= 0 ? "+" : ""}{fmtPct(portfolioReturn, 2)}
          </div>
        </Card>
        <Card>
          <div className="label-cap">KSE-100</div>
          <div
            className="font-display mono-num text-[22px] mt-1"
            style={{
              fontVariationSettings: "'opsz' 144",
              color: kseReturn >= 0 ? "var(--positive)" : "var(--negative)",
            }}
          >
            {kseReturn >= 0 ? "+" : ""}{fmtPct(kseReturn, 2)}
          </div>
        </Card>
        <Card>
          <div className="label-cap">Alpha (you − KSE)</div>
          <div
            className="font-display mono-num text-[22px] mt-1"
            style={{
              fontVariationSettings: "'opsz' 144",
              color: alpha >= 0 ? "var(--positive)" : "var(--negative)",
            }}
          >
            {alpha >= 0 ? "+" : ""}{fmtPct(alpha, 2)}
          </div>
        </Card>
      </div>
      <BenchmarkChart points={data.points} />
      <p className="text-[11px] text-muted font-mono">
        {data.range.from} → {data.range.to} · USD/PKR, S&P 500, SBP rate comparisons coming next.
      </p>
    </div>
  );
}
