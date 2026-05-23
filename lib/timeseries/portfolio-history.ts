import type { Transaction } from "@/lib/types";
import { fetchEodSeries, fetchManyEod, type EodPoint } from "./psx-eod";

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

// Build a lookup of {date -> close} for a symbol, then for missing dates
// carry forward the last known close.
function indexBySeries(series: EodPoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of series) m.set(p.date, p.close);
  return m;
}

function closeOnOrBefore(idx: Map<string, number>, sortedDates: string[], date: string): number | null {
  // Binary search would be nicer; linear is fine for 90 days.
  let last: number | null = null;
  for (const d of sortedDates) {
    if (d > date) break;
    const v = idx.get(d);
    if (v != null) last = v;
  }
  return last;
}

export type BenchmarkPoint = {
  date: string;
  portfolioValue: number;
  kse100: number;
  portfolioIndex: number; // indexed to 100 at start
  kse100Index: number;
};

export type BenchmarkSeries = {
  range: { from: string; to: string };
  points: BenchmarkPoint[];
  portfolioStart: number;
  portfolioEnd: number;
  kseStart: number;
  kseEnd: number;
};

export async function buildBenchmarkSeries({
  transactions,
  days = 90,
}: {
  transactions: Transaction[];
  days?: number;
}): Promise<BenchmarkSeries | null> {
  const from = isoNDaysAgo(days);
  const to = isoToday();

  // Collect unique symbols that have any transaction before "to".
  const symbols = Array.from(
    new Set(
      transactions
        .filter((t) => new Date(t.date).toISOString().slice(0, 10) <= to)
        .map((t) => t.symbol)
    )
  );

  if (symbols.length === 0) {
    // Still return KSE100 alone so the chart shows something useful.
  }

  const [kseSeries, symbolMap] = await Promise.all([
    fetchEodSeries("KSE100"),
    fetchManyEod(symbols),
  ]);

  if (kseSeries.length === 0) return null;

  // Build full date list from KSE 100 series within range.
  const datesInRange = kseSeries.map((p) => p.date).filter((d) => d >= from && d <= to);
  if (datesInRange.length === 0) return null;

  // Build per-symbol fast lookup.
  const symbolIdx = new Map<string, { idx: Map<string, number>; dates: string[] }>();
  for (const [sym, series] of symbolMap) {
    symbolIdx.set(sym, { idx: indexBySeries(series), dates: series.map((p) => p.date) });
  }

  const points: BenchmarkPoint[] = [];
  let portfolioStartVal = 0;
  let kseStartVal = 0;
  let started = false;

  const kseIdx = indexBySeries(kseSeries);

  for (const date of datesInRange) {
    const shares = sharesHeldAt(date, transactions);
    let pVal = 0;
    let priceableSymbols = 0;
    for (const [sym, count] of shares) {
      if (count <= 0) continue;
      const info = symbolIdx.get(sym);
      if (!info) continue;
      const close = closeOnOrBefore(info.idx, info.dates, date);
      if (close == null) continue;
      pVal += count * close;
      priceableSymbols++;
    }
    const kVal = kseIdx.get(date) ?? 0;
    if (!started && pVal > 0 && kVal > 0) {
      portfolioStartVal = pVal;
      kseStartVal = kVal;
      started = true;
    }
    points.push({
      date,
      portfolioValue: pVal,
      kse100: kVal,
      portfolioIndex: portfolioStartVal > 0 ? (pVal / portfolioStartVal) * 100 : 0,
      kse100Index: kseStartVal > 0 ? (kVal / kseStartVal) * 100 : 0,
    });
  }

  // Trim any leading rows before the first day we have a portfolio value.
  const trimmed = points.filter((p) => p.portfolioValue > 0 || p.kse100 > 0);
  if (trimmed.length === 0) return null;

  return {
    range: { from: trimmed[0].date, to: trimmed[trimmed.length - 1].date },
    points: trimmed,
    portfolioStart: portfolioStartVal,
    portfolioEnd: trimmed[trimmed.length - 1].portfolioValue,
    kseStart: kseStartVal,
    kseEnd: trimmed[trimmed.length - 1].kse100,
  };
}
