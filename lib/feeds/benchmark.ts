import { getAllTransactions, getSbpRateSteps, getSavingsValued, getMutualFundsValued, getCashEntries, getAppSettings, getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { buildBenchmarkSeries, type BenchmarkSeries } from "@/lib/timeseries/portfolio-history";

export const BENCHMARK_RANGES = ["90D", "1Y", "ALL"] as const;
export const benchmarkKey = (range: string) => `benchmark:${range}`;

// Cached wrapper shared by the API route and the Wealth page: the series needs
// a dozen live external fetches (PSX EOD per symbol + Yahoo for FX, gold and
// seven world indices), so we serve a per-user snapshot for 3h and fall back
// to the last-good copy when a recompute fails — a Yahoo blip must never blank
// a page.
const FRESH_MS = 3 * 60 * 60 * 1000;

export async function computeBenchmarkCached(
  rangeKey: string,
  uid: string,
  force = false
): Promise<{ series: BenchmarkSeries | null; cached: boolean; stale: boolean; updatedAt?: string }> {
  const key = `${benchmarkKey(rangeKey)}:${uid}`;
  const cached = await getFeedSnapshot<BenchmarkSeries>(key);
  const fresh = cached.data && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < FRESH_MS;
  if (!force && fresh) return { series: cached.data!, cached: true, stale: false, updatedAt: String(cached.updatedAt) };

  try {
    const series = await computeBenchmark(rangeKey);
    if (series && series.points.length > 0) {
      await saveFeedSnapshot(key, series, "ok").catch(() => {});
      return { series, cached: false, stale: false };
    }
  } catch {
    /* fall through to stale snapshot */
  }
  if (cached.data) return { series: cached.data, cached: true, stale: true, updatedAt: String(cached.updatedAt) };
  return { series: null, cached: false, stale: false };
}

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
