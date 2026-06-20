import { getAllTransactions, getSbpRateSteps, getSavingsValued, getMutualFundsValued, getCashEntries, getAppSettings } from "@/lib/data";
import { buildBenchmarkSeries } from "@/lib/timeseries/portfolio-history";

export const BENCHMARK_RANGES = ["90D", "1Y", "ALL"] as const;
export const benchmarkKey = (range: string) => `benchmark:${range}`;

// Assemble the inputs and build the benchmark series for one range. Shared by
// the live API route and the scheduled snapshot cron (which pre-warms the cache).
export async function computeBenchmark(rangeKey: string) {
  const [txs, { steps }, savings, funds, cashEntries, settings] = await Promise.all([
    getAllTransactions(),
    getSbpRateSteps(),
    getSavingsValued().catch(() => []),
    getMutualFundsValued().catch(() => []),
    getCashEntries().catch(() => []),
    getAppSettings().catch(() => ({ inflationPct: 0 } as any)),
  ]);
  const netWorthExtras = {
    savings: (savings as any[]).map((a) => ({ ratePercent: a.ratePercent, anchorDate: a.anchorDate, anchorBalance: a.anchorBalance, movements: a.movements ?? [] })),
    fundsNow: (funds as any[]).reduce((s, f) => s + (f.value ?? 0), 0),
    commoditiesNow: 0,
    cashEntries: (cashEntries as any[]).map((e) => ({ date: e.date, type: e.type, amount: e.amount })),
  };
  return buildBenchmarkSeries({ transactions: txs, rangeKey, rateSteps: steps, netWorthExtras, inflationPct: (settings as any).inflationPct ?? 0 });
}
