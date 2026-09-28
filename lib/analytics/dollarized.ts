// Returns in dollars: the share book measured in US dollars, so a gain that
// only kept pace with a falling rupee shows as what it is.
//
// Every rupee that went in or came out is converted at the USD/PKR rate of
// its own day: each buy (and right) in, each sale and each dividend taken
// out. What is held now is converted at today's rate. The dollar return is
// the difference, the same sum the Total return card does in rupees (value
// now, less buys, plus sales and dividends), only with each flow at its
// day's rate. USD/PKR is Yahoo's (PKR=X), an international series, and the
// same one the model's report keeps under MACRO:usdpkr.

import { mongoBarsCache } from "@/lib/quant/store";
import { fetchUsdPkrDaily } from "@/lib/timeseries/macro";

export type RatePoint = { date: string; close: number };

export type Dollarized = {
  rateNow: number; // rupees per dollar, the latest close
  rateDate: string;
  firstDate: string | null; // the first buy
  rateFirst: number | null;
  putInUsd: number; // buys less sales and dividends, each at its day's rate
  valueUsd: number; // what is held, at today's rate
  returnUsd: number;
  returnPct: number | null; // on the dollars put in
  putInPkr: number; // the same flows in rupees
  returnPkrPct: number | null; // the same sum in rupees, for comparison
  rupeePct: number | null; // the rupee against the dollar since the first buy (negative: weaker)
};

type Flow = { date: string | Date; type: string; netAmount?: number | null; totalAmount?: number | null; symbol?: string };

const iso = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

// The close on or before a date, by binary search on sorted dates. Before the
// series starts, its first close is the nearest there is.
export function rateOn(rates: RatePoint[], date: string): number | null {
  if (rates.length === 0) return null;
  if (date < rates[0].date) return rates[0].close;
  let lo = 0, hi = rates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rates[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  return rates[lo].close;
}

// Money in (+) or out (-) for one transaction, in rupees; 0 when it moves none.
export function flowOf(t: Flow): number {
  const amt = Math.abs(Number(t.netAmount || t.totalAmount || 0));
  if (!(amt > 0)) return 0;
  if (t.type === "BUY" || t.type === "RIGHT") return amt;
  if (t.type === "SELL" || t.type === "DIVIDEND") return -amt;
  return 0;
}

export function dollarize(txs: Flow[], valueNowPkr: number, rates: RatePoint[]): Dollarized | null {
  if (rates.length === 0) return null;
  let putInUsd = 0, putInPkr = 0;
  let firstDate: string | null = null;
  for (const t of txs) {
    const f = flowOf(t);
    if (f === 0) continue;
    const d = iso(t.date);
    const r = rateOn(rates, d)!;
    putInUsd += f / r;
    putInPkr += f;
    if (f > 0 && (!firstDate || d < firstDate)) firstDate = d;
  }
  if (!firstDate) return null;
  const last = rates[rates.length - 1];
  const valueUsd = valueNowPkr / last.close;
  const rateFirst = rateOn(rates, firstDate);
  return {
    rateNow: last.close,
    rateDate: last.date,
    firstDate,
    rateFirst,
    putInUsd,
    valueUsd,
    returnUsd: valueUsd - putInUsd,
    returnPct: putInUsd > 0 ? ((valueUsd - putInUsd) / putInUsd) * 100 : null,
    putInPkr,
    returnPkrPct: putInPkr > 0 ? ((valueNowPkr - putInPkr) / putInPkr) * 100 : null,
    rupeePct: rateFirst ? (rateFirst / last.close - 1) * 100 : null,
  };
}

// One name in dollars: the rupee cost basis (lib/calculations/holding.ts) run
// again with every amount at its own day's rate. A buy or a right adds its
// dollars; a sale takes out its proportion of the dollar cost, the way it
// takes out its proportion of the rupee cost; bonuses and splits move shares
// only. So the dollar figures line up with the rupee ones beside them in the
// holdings table: unrealised on what the shares still held cost, and the
// Total P&L's unrealised plus dividends.
export type DollarBasisTx = { date: string | Date; type: string; shares?: number | null; netAmount?: number | null; ratio?: string | null };

export function dollarCostBasis(txs: DollarBasisTx[], rates: RatePoint[]): { shares: number; costUsd: number; dividendsUsd: number; realizedUsd: number; firstDate: string | null } {
  const s = { shares: 0, costUsd: 0, dividendsUsd: 0, realizedUsd: 0, firstDate: null as string | null };
  const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (const tx of sorted) {
    const d = iso(tx.date);
    const r = rateOn(rates, d);
    if (!r) continue;
    const usd = Number(tx.netAmount ?? 0) / r;
    const n = Number(tx.shares ?? 0);
    switch (tx.type) {
      case "BUY":
      case "RIGHT":
        s.shares += n;
        s.costUsd += usd;
        if (!s.firstDate) s.firstDate = d;
        break;
      case "SELL": {
        const sold = Math.abs(n);
        if (s.shares <= 0 || sold <= 0) break;
        const removed = s.costUsd * Math.min(1, sold / s.shares);
        s.realizedUsd += usd - removed;
        s.costUsd -= removed;
        s.shares -= sold;
        break;
      }
      case "DIVIDEND":
        s.dividendsUsd += usd;
        break;
      case "BONUS":
        s.shares += n;
        break;
      case "SPLIT": {
        const [from, to] = String(tx.ratio ?? "").split(":").map((x) => Number(x.trim()));
        if (from && to) s.shares *= to / from;
        break;
      }
    }
  }
  return s;
}

export type HoldingDollars = {
  rateNow: number;
  valueUsd: number; // the shares held, at today's rate
  costUsd: number; // what they cost, each purchase at its day's rate
  dividendsUsd: number; // every dividend on the name, at its pay day's rate
  unrealizedUsd: number;
  unrealizedPct: number | null; // on costUsd
  totalUsd: number; // unrealised plus dividends, as the table's Total P&L
  totalPct: number | null; // on costUsd
  firstDate: string | null;
  rateFirst: number | null;
};

export function holdingDollars(txs: DollarBasisTx[], marketValuePkr: number, rates: RatePoint[]): HoldingDollars | null {
  if (rates.length === 0) return null;
  const b = dollarCostBasis(txs, rates);
  if (!(b.costUsd > 0)) return null;
  const rateNow = rates[rates.length - 1].close;
  const valueUsd = marketValuePkr / rateNow;
  const unrealizedUsd = valueUsd - b.costUsd;
  const totalUsd = unrealizedUsd + b.dividendsUsd;
  return {
    rateNow,
    valueUsd,
    costUsd: b.costUsd,
    dividendsUsd: b.dividendsUsd,
    unrealizedUsd,
    unrealizedPct: (unrealizedUsd / b.costUsd) * 100,
    totalUsd,
    totalPct: (totalUsd / b.costUsd) * 100,
    firstDate: b.firstDate,
    rateFirst: b.firstDate ? rateOn(rates, b.firstDate) : null,
  };
}

// Dollars put in, net, as of each date: every buy less every sale up to it,
// each at its own day's rate. The dollar twin of the chart's dashed line
// (which, like it, leaves dividends out).
export function investedUsdSeries(txs: Flow[], dates: string[], rates: RatePoint[]): number[] {
  const flows = txs
    .filter((t) => t.type === "BUY" || t.type === "RIGHT" || t.type === "SELL")
    .map((t) => ({ date: iso(t.date), usd: flowOf(t) / (rateOn(rates, iso(t.date)) ?? NaN) }))
    .filter((f) => Number.isFinite(f.usd) && f.usd !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: number[] = [];
  let k = 0, sum = 0;
  for (const d of dates) {
    while (k < flows.length && flows[k].date <= d) sum += flows[k++].usd;
    out.push(Math.max(0, sum));
  }
  return out;
}

// USD/PKR from 2001 (hourly-backed for the last two years: see
// fetchUsdPkrDaily), the cached copy when it is under a day old; a failed
// fetch falls back to the last copy there is.
export async function loadUsdPkr(): Promise<RatePoint[]> {
  const cache = mongoBarsCache(24);
  let bars = await cache.get("MACRO:usdpkr").catch(() => null);
  if (!bars || bars.length === 0) {
    const fresh = await fetchUsdPkrDaily().catch(() => []);
    if (fresh.length > 500) {
      bars = fresh;
      await cache.put("MACRO:usdpkr", fresh).catch(() => {});
    } else bars = (await cache.getStale?.("MACRO:usdpkr").catch(() => null)) ?? fresh;
  }
  return (bars ?? []).filter((b) => b.close > 0).map((b) => ({ date: b.date, close: b.close }));
}
