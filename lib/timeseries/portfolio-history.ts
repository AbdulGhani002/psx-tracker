import type { Transaction } from "@/lib/types";
import type { EodPoint } from "./psx-eod";
import { eodSeriesCached as fetchEodSeries, manyEodCached as fetchManyEod } from "./eod-cache";
import { fetchYahooDaily, type YahooRange } from "./yahoo";
import { riskFreeIndex, type RateStep } from "./sbp-rate";
import { computeCashBalance } from "../calculations/cash";

const DAY_MS = 24 * 60 * 60 * 1000;
function daysBetween(aIso: string, bIso: string): number {
  return Math.max(0, (new Date(bIso).getTime() - new Date(aIso).getTime()) / DAY_MS);
}

// Savings balance as of a date: anchor + movements, each compounded daily at the
// account rate from its event date forward.
function savingsValueAt(
  acc: { ratePercent: number; anchorDate: string; anchorBalance: number; movements: { date: string; type: string; amount: number }[] },
  dIso: string
): number {
  const r = acc.ratePercent / 100 / 365;
  const events = [
    { date: new Date(acc.anchorDate).toISOString().slice(0, 10), amount: acc.anchorBalance },
    ...acc.movements.map((m) => ({ date: new Date(m.date).toISOString().slice(0, 10), amount: m.type === "WITHDRAWAL" ? -m.amount : m.amount })),
  ]
    .filter((e) => e.date <= dIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (events.length === 0) return 0;
  let bal = 0;
  let last: string | null = null;
  for (const e of events) {
    if (last) bal *= Math.pow(1 + r, daysBetween(last, e.date));
    bal += e.amount;
    last = e.date;
  }
  if (last) bal *= Math.pow(1 + r, daysBetween(last, dIso));
  return bal;
}

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
  | "portfolioTR"
  | "portfolioReal"
  | "netWorth"
  | "kse100"
  | "kmi30"
  | "gold"
  | "portfolioUsd"
  | "sp500"
  | "usdpkr"
  | "riskFree"
  | WorldIndexKey;

// The famous world indices, each in its OWN currency (that's how they're
// quoted everywhere; a PKR investor's realised return would add the rupee's
// slide on top — the USD/PKR series carries that separately).
export const WORLD_INDICES = {
  ndx100: { yahoo: "^NDX", label: "NASDAQ 100", ccy: "USD" },
  ftse100: { yahoo: "^FTSE", label: "FTSE 100", ccy: "GBP" },
  dowjones: { yahoo: "^DJI", label: "Dow Jones", ccy: "USD" },
  dax: { yahoo: "^GDAXI", label: "DAX 40", ccy: "EUR" },
  nikkei225: { yahoo: "^N225", label: "Nikkei 225", ccy: "JPY" },
  sensex: { yahoo: "^BSESN", label: "Sensex", ccy: "INR" },
} as const;
export type WorldIndexKey = keyof typeof WORLD_INDICES;
const WORLD_KEYS = Object.keys(WORLD_INDICES) as WorldIndexKey[];

// Extra assets to fold into a total net-worth line. Funds/commodities lack daily
// history so they're held at their current value across the window (honest
// approximation); savings compound and cash is reconstructed from the ledger.
export type NetWorthExtras = {
  savings: { ratePercent: number; anchorDate: string; anchorBalance: number; movements: { date: string; type: string; amount: number }[] }[];
  fundsNow: number;
  commoditiesNow: number;
  cashEntries: { date: string | Date; type: string; amount: number }[];
};

export type BenchmarkPoint = {
  date: string;
  portfolioValue: number;
  portfolio: number | null; // indexed to 100 (price only)
  portfolioTR: number | null; // total return: price + dividends reinvested
  portfolioReal: number | null; // total return adjusted for inflation (real)
  netWorth: number | null;
  kse100: number | null;
  kmi30: number | null;
  gold: number | null; // gold price in PKR, indexed
  portfolioUsd: number | null;
  sp500: number | null;
  usdpkr: number | null;
  riskFree: number | null;
} & Record<WorldIndexKey, number | null>;

export type BenchmarkSeries = {
  range: { from: string; to: string; key: string };
  points: BenchmarkPoint[];
  returns: Partial<Record<SeriesKey, number>>; // window total return per series
  available: SeriesKey[]; // which series actually have data
};

const RANGE_TO_DAYS: Record<string, number> = {
  "1M": 31,
  "3M": 92,
  "90D": 90,
  "1Y": 365,
  "3Y": 1096,
  ALL: 3650,
};
const RANGE_TO_YAHOO: Record<string, YahooRange> = {
  "1M": "3mo",
  "3M": "3mo",
  "90D": "3mo",
  "1Y": "1y",
  "3Y": "5y",
  ALL: "5y",
};

export async function buildBenchmarkSeries({
  transactions,
  rangeKey = "90D",
  rateSteps,
  netWorthExtras,
  inflationPct = 0,
}: {
  transactions: Transaction[];
  rangeKey?: string;
  rateSteps?: RateStep[];
  netWorthExtras?: NetWorthExtras;
  inflationPct?: number;
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
  const [kseSeries, kmiSeries, usdpkrSeries, sp500Series, goldSeries, symbolMap, ...worldSeries] =
    await Promise.all([
      fetchEodSeries("KSE100"),
      fetchEodSeries("KMI30"),
      fetchYahooDaily("USDPKR=X", yahooRange),
      fetchYahooDaily("^GSPC", yahooRange),
      fetchYahooDaily("GC=F", yahooRange), // gold, USD per troy ounce
      fetchManyEod(symbols),
      ...WORLD_KEYS.map((k) => fetchYahooDaily(WORLD_INDICES[k].yahoo, yahooRange)),
    ] as const);
  const worldLookup = new Map(
    WORLD_KEYS.map((k, i) => {
      const s = worldSeries[i] ?? [];
      return [k, { idx: indexBySeries(s), dates: s.map((p) => p.date) }] as const;
    })
  );

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
  const goldIdx = indexBySeries(goldSeries);
  const goldDates = goldSeries.map((p) => p.date);

  // Raw (un-indexed) per-date values.
  type Raw = {
    date: string;
    portfolioValue: number;
    kse: number | null;
    kmi: number | null;
    usd: number | null;
    sp: number | null;
    goldPkr: number | null; // gold price converted to PKR
    world: Record<WorldIndexKey, number | null>;
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
    const usdHere = closeOnOrBefore(usdIdx, usdDates, date);
    const goldUsd = closeOnOrBefore(goldIdx, goldDates, date);
    const world = Object.fromEntries(
      WORLD_KEYS.map((k) => {
        const w = worldLookup.get(k)!;
        return [k, closeOnOrBefore(w.idx, w.dates, date)];
      })
    ) as Record<WorldIndexKey, number | null>;
    return {
      date,
      portfolioValue: pVal,
      kse: kseIdx.get(date) ?? null,
      kmi: closeOnOrBefore(kmiIdx, kmiDates, date),
      usd: usdHere,
      sp: closeOnOrBefore(spIdx, spDates, date),
      goldPkr: goldUsd != null && usdHere != null ? goldUsd * usdHere : null,
      world,
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
    gold: trimmed.find((r) => r.goldPkr != null)?.goldPkr ?? 0,
  };
  const worldBase = Object.fromEntries(
    WORLD_KEYS.map((k) => [k, trimmed.find((r) => r.world[k] != null)?.world[k] ?? 0])
  ) as Record<WorldIndexKey, number>;

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

  // TOTAL-RETURN portfolio line: same price path as the TWR line, but dividends
  // RECEIVED are reinvested on their pay date — so the gap between this line and
  // the price-only line is exactly the contribution of your dividends. High-
  // dividend stocks lag on price but this line captures what they really return.
  const divByDate = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== "DIVIDEND") continue;
    const d = new Date(tx.date).toISOString().slice(0, 10);
    divByDate.set(d, (divByDate.get(d) ?? 0) + (tx.netAmount ?? 0));
  }
  const tr: number[] = [];
  let trIdx = 100;
  for (let i = 0; i < trimmed.length; i++) {
    if (i === 0) {
      tr.push(100);
      continue;
    }
    const prevDate = trimmed[i - 1].date;
    const currDate = trimmed[i].date;
    const prevShares = sharesHeldAt(prevDate, transactions);
    const bmv = valueOfSharesAt(prevShares, prevDate);
    const emv = valueOfSharesAt(prevShares, currDate);
    let div = 0;
    for (const [d, amt] of divByDate) if (d > prevDate && d <= currDate) div += amt;
    if (bmv > 0 && emv > 0) trIdx *= (emv + div) / bmv;
    tr.push(trIdx);
  }

  // Inflation-adjusted (real) total return: deflate the total-return index by the
  // annual inflation rate compounded over elapsed time — growth in real,
  // purchasing-power terms (so high PKR inflation eats into the nominal gain).
  const real: number[] = [];
  const startDate = trimmed[0].date;
  for (let i = 0; i < trimmed.length; i++) {
    const years = daysBetween(startDate, trimmed[i].date) / 365;
    const deflate = inflationPct > 0 ? Math.pow(1 + inflationPct / 100, years) : 1;
    real.push((tr[i] ?? 100) / deflate);
  }

  const riskFree = riskFreeIndex(trimmed.map((r) => r.date), rateSteps, 100);

  // NET WORTH time-weighted return: total wealth per day (stocks live + savings
  // compounded + cash from the ledger + funds/commodities held flat at current),
  // with external cash deposits/withdrawals neutralized so the line is return,
  // not contributions.
  // Net-worth daily return as a value-weighted blend of each asset's OWN return:
  // stocks move with the market (held shares priced at both days), savings accrue
  // interest, funds/cash contribute no daily return. Weighting by each asset's
  // value at the start of the day. This avoids any cash-flow artifacts entirely
  // (buys/deposits move money between buckets without inventing return).
  const netWorthIdx: (number | null)[] = [];
  if (netWorthExtras) {
    const ex = netWorthExtras;
    const savingsTotalAt = (dIso: string) => ex.savings.reduce((s, a) => s + savingsValueAt(a, dIso), 0);
    const savingsDailyRateAt = (dIso: string) => {
      let val = 0, weighted = 0;
      for (const a of ex.savings) {
        const v = savingsValueAt(a, dIso);
        val += v;
        weighted += v * (a.ratePercent / 100 / 365);
      }
      return val > 0 ? weighted / val : 0;
    };
    const cashAt = (dIso: string): number => {
      const txs = transactions.filter((t) => new Date(t.date).toISOString().slice(0, 10) <= dIso);
      const entries = ex.cashEntries.filter((e) => new Date(e.date).toISOString().slice(0, 10) <= dIso);
      try {
        return computeCashBalance(txs as any, entries as any).balance;
      } catch {
        return 0;
      }
    };

    let nwIdx = 100;
    netWorthIdx.push(100);
    for (let i = 1; i < trimmed.length; i++) {
      const prevDate = trimmed[i - 1].date;
      const currDate = trimmed[i].date;
      const prevShares = sharesHeldAt(prevDate, transactions);
      const bmv = valueOfSharesAt(prevShares, prevDate);
      const emv = valueOfSharesAt(prevShares, currDate);
      const stockRet = bmv > 0 ? emv / bmv - 1 : 0;
      const wStocks = trimmed[i - 1].portfolioValue;
      const wSavings = savingsTotalAt(prevDate);
      const wCash = cashAt(prevDate);
      const wFunds = ex.fundsNow;
      const totalW = wStocks + wSavings + wCash + wFunds;
      const dailyRet = totalW > 0 ? (wStocks * stockRet + wSavings * savingsDailyRateAt(prevDate)) / totalW : 0;
      if (Number.isFinite(dailyRet)) nwIdx *= 1 + dailyRet;
      netWorthIdx.push(nwIdx);
    }
  }

  const idx100 = (v: number | null, b: number): number | null =>
    v != null && b > 0 ? (v / b) * 100 : null;

  const hasUsd = base.usd > 0;
  const points: BenchmarkPoint[] = trimmed.map((r, i) => ({
    date: r.date,
    portfolioValue: r.portfolioValue,
    portfolio: twr[i] ?? null,
    portfolioTR: tr[i] ?? null,
    portfolioReal: real[i] ?? null,
    netWorth: netWorthExtras ? netWorthIdx[i] ?? null : null,
    kse100: idx100(r.kse, base.kse),
    kmi30: idx100(r.kmi, base.kmi),
    gold: idx100(r.goldPkr, base.gold),
    portfolioUsd: hasUsd ? twrUsd[i] ?? null : null,
    sp500: idx100(r.sp, base.sp),
    usdpkr: idx100(r.usd, base.usd),
    riskFree: riskFree[i] ?? null,
    ...(Object.fromEntries(WORLD_KEYS.map((k) => [k, idx100(r.world[k], worldBase[k])])) as Record<WorldIndexKey, number | null>),
  }));

  const last = points[points.length - 1];
  const ret = (series: SeriesKey): number | undefined => {
    const v = last[series as keyof BenchmarkPoint] as number | null;
    return v != null ? v / 100 - 1 : undefined;
  };

  const returns: Partial<Record<SeriesKey, number>> = {};
  const available: SeriesKey[] = [];
  for (const k of ["portfolio", "portfolioTR", "portfolioReal", "netWorth", "kse100", "kmi30", "gold", "portfolioUsd", "sp500", "usdpkr", "riskFree", ...WORLD_KEYS] as SeriesKey[]) {
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
