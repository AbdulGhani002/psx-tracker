import type { Transaction } from "@/lib/types";
import { fetchEodSeries, fetchManyEod, type EodPoint } from "./psx-eod";
import { fetchYahooDaily, type YahooRange } from "./yahoo";
import { riskFreeIndex, type RateStep } from "./sbp-rate";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sharesHeldAt(date: string, txs: Transaction[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const tx of txs) {
    const txDate = new Date(tx.date).toISOString().slice(0, 10);
    if (txDate > date) continue;
    const sym = tx.symbol;
    const cur = out.get(sym) ?? 0;
    switch (tx.type) {
      case "BUY":
      case "RIGHT":
      case "BONUS":
        out.set(sym, cur + tx.shares);
        break;
      case "SELL":
        out.set(sym, cur + tx.shares); // tx.shares is already negative for sells
        break;
      case "SPLIT": {
        const [from, to] = tx.ratio.split(":").map((s) => Number(s.trim()));
        if (from && to) out.set(sym, cur * (to / from));
        break;
      }
      // DIVIDEND has no share impact.
    }
  }
  return out;
}

function indexBySeries(series: EodPoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of series) m.set(p.date, p.close);
  return m;
}

// Carry-forward lookup: most recent close on or before `date`.
function closeOnOrBefore(
  idx: Map<string, number>,
  sortedDates: string[],
  date: string
): number | null {
  let last: number | null = null;
  for (const d of sortedDates) {
    if (d > date) break;
    const v = idx.get(d);
    if (v != null) last = v;
  }
  return last;
}

export type SeriesKey =
  | "portfolio"
  | "kse100"
  | "kmi30"
  | "portfolioUsd"
  | "sp500"
  | "usdpkr"
  | "riskFree";

export type BenchmarkPoint = {
  date: string;
  portfolioValue: number;
  portfolio: number | null; // indexed to 100
  kse100: number | null;
  kmi30: number | null;
  portfolioUsd: number | null;
  sp500: number | null;
  usdpkr: number | null;
  riskFree: number | null;
};

export type BenchmarkSeries = {
  range: { from: string; to: string; key: string };
  points: BenchmarkPoint[];
  returns: Partial<Record<SeriesKey, number>>; // window total return per series
  available: SeriesKey[]; // which series actually have data
};

const RANGE_TO_DAYS: Record<string, number> = {
  "90D": 90,
  "1Y": 365,
  ALL: 3650,
};
const RANGE_TO_YAHOO: Record<string, YahooRange> = {
  "90D": "3mo",
  "1Y": "1y",
  ALL: "5y",
};

export async function buildBenchmarkSeries({
  transactions,
  rangeKey = "90D",
  rateSteps,
}: {
  transactions: Transaction[];
  rangeKey?: string;
  rateSteps?: RateStep[];
}): Promise<BenchmarkSeries | null> {
  const days = RANGE_TO_DAYS[rangeKey] ?? 90;
  const yahooRange = RANGE_TO_YAHOO[rangeKey] ?? "3mo";
  const from = isoNDaysAgo(days);
  const to = isoToday();

  const symbols = Array.from(
    new Set(
      transactions
        .filter((t) => new Date(t.date).toISOString().slice(0, 10) <= to)
        .map((t) => t.symbol)
    )
  );

  // Fetch everything in parallel. Each failure degrades to an empty series.
  const [kseSeries, kmiSeries, usdpkrSeries, sp500Series, symbolMap] =
    await Promise.all([
      fetchEodSeries("KSE100"),
      fetchEodSeries("KMI30"),
      fetchYahooDaily("USDPKR=X", yahooRange),
      fetchYahooDaily("^GSPC", yahooRange),
      fetchManyEod(symbols),
    ]);

  if (kseSeries.length === 0) return null;

  // Trading-day calendar = KSE100 dates within range.
  const datesInRange = kseSeries
    .map((p) => p.date)
    .filter((d) => d >= from && d <= to);
  if (datesInRange.length === 0) return null;

  // Per-symbol fast lookups for portfolio valuation.
  const symbolIdx = new Map<string, { idx: Map<string, number>; dates: string[] }>();
  for (const [sym, series] of symbolMap) {
    symbolIdx.set(sym, { idx: indexBySeries(series), dates: series.map((p) => p.date) });
  }

  const kseIdx = indexBySeries(kseSeries);
  const kmiIdx = indexBySeries(kmiSeries);
  const kmiDates = kmiSeries.map((p) => p.date);
  const usdIdx = indexBySeries(usdpkrSeries);
  const usdDates = usdpkrSeries.map((p) => p.date);
  const spIdx = indexBySeries(sp500Series);
  const spDates = sp500Series.map((p) => p.date);

  // Raw (un-indexed) per-date values.
  type Raw = {
    date: string;
    portfolioValue: number;
    kse: number | null;
    kmi: number | null;
    usd: number | null;
    sp: number | null;
  };
  const raws: Raw[] = datesInRange.map((date) => {
    const shares = sharesHeldAt(date, transactions);
    let pVal = 0;
    for (const [sym, count] of shares) {
      if (count <= 0) continue;
      const info = symbolIdx.get(sym);
      if (!info) continue;
      const close = closeOnOrBefore(info.idx, info.dates, date);
      if (close == null) continue;
      pVal += count * close;
    }
    return {
      date,
      portfolioValue: pVal,
      kse: kseIdx.get(date) ?? null,
      kmi: closeOnOrBefore(kmiIdx, kmiDates, date),
      usd: closeOnOrBefore(usdIdx, usdDates, date),
      sp: closeOnOrBefore(spIdx, spDates, date),
    };
  });

  // Trim leading rows before the portfolio actually has value.
  const firstWithValue = raws.findIndex((r) => r.portfolioValue > 0);
  const trimmed = firstWithValue >= 0 ? raws.slice(firstWithValue) : raws;
  if (trimmed.length === 0) return null;

  // Index bases for the market series (no cash flows — straight price indexing).
  const base = {
    kse: trimmed.find((r) => r.kse != null)?.kse ?? 0,
    kmi: trimmed.find((r) => r.kmi != null)?.kmi ?? 0,
    sp: trimmed.find((r) => r.sp != null)?.sp ?? 0,
    usd: trimmed.find((r) => r.usd != null)?.usd ?? 0,
  };

  // Value a given share map at a given date (carry-forward close).
  const valueOfSharesAt = (shares: Map<string, number>, date: string): number => {
    let v = 0;
    for (const [sym, count] of shares) {
      if (count <= 0) continue;
      const info = symbolIdx.get(sym);
      if (!info) continue;
      const c = closeOnOrBefore(info.idx, info.dates, date);
      if (c != null) v += count * c;
    }
    return v;
  };

  // TIME-WEIGHTED RETURN for the portfolio — neutralises deposits/buys so the
  // line reflects market performance of the holdings, not cash inflows.
  // Each day's return prices YESTERDAY's shares at both days, so any buy/sell
  // executed today is excluded from today's return.
  const twr: number[] = [];
  const twrUsd: number[] = [];
  let tIdx = 100;
  let tUsdIdx = 100;
  for (let i = 0; i < trimmed.length; i++) {
    if (i === 0) {
      twr.push(100);
      twrUsd.push(100);
      continue;
    }
    const prevDate = trimmed[i - 1].date;
    const currDate = trimmed[i].date;
    const prevShares = sharesHeldAt(prevDate, transactions);
    const bmv = valueOfSharesAt(prevShares, prevDate);
    const emv = valueOfSharesAt(prevShares, currDate);
    if (bmv > 0 && emv > 0) tIdx *= emv / bmv;
    twr.push(tIdx);

    const usdPrev = trimmed[i - 1].usd;
    const usdCurr = trimmed[i].usd;
    if (bmv > 0 && emv > 0 && usdPrev && usdCurr) {
      tUsdIdx *= emv / usdCurr / (bmv / usdPrev);
    }
    twrUsd.push(tUsdIdx);
  }

  const riskFree = riskFreeIndex(trimmed.map((r) => r.date), rateSteps, 100);

  const idx100 = (v: number | null, b: number): number | null =>
    v != null && b > 0 ? (v / b) * 100 : null;

  const hasUsd = base.usd > 0;
  const points: BenchmarkPoint[] = trimmed.map((r, i) => ({
    date: r.date,
    portfolioValue: r.portfolioValue,
    portfolio: twr[i] ?? null,
    kse100: idx100(r.kse, base.kse),
    kmi30: idx100(r.kmi, base.kmi),
    portfolioUsd: hasUsd ? twrUsd[i] ?? null : null,
    sp500: idx100(r.sp, base.sp),
    usdpkr: idx100(r.usd, base.usd),
    riskFree: riskFree[i] ?? null,
  }));

  const last = points[points.length - 1];
  const ret = (series: SeriesKey): number | undefined => {
    const v = last[series as keyof BenchmarkPoint] as number | null;
    return v != null ? v / 100 - 1 : undefined;
  };

  const returns: Partial<Record<SeriesKey, number>> = {};
  const available: SeriesKey[] = [];
  for (const k of ["portfolio", "kse100", "kmi30", "portfolioUsd", "sp500", "usdpkr", "riskFree"] as SeriesKey[]) {
    const r = ret(k);
    if (r !== undefined) {
      returns[k] = r;
      available.push(k);
    }
  }

  return {
    range: { from: trimmed[0].date, to: trimmed[trimmed.length - 1].date, key: rangeKey },
    points,
    returns,
    available,
  };
}
