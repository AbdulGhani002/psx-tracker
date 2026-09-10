// The model's own rule, tested as a rule.
//
// AUCs say whether the model can rank; this says what following it would
// have done. Every `horizon` sessions the universe is re-sorted by the
// model's odds of beating the market and the top fifth is held, equal
// weight, for the next `horizon` sessions. Two gates on top, both readable
// from a chart: the market is "strong" when the equal-weight index sits above
// its 200-day average, and "broad" when at least the floor share of names sit
// above theirs. When the gate is shut the rule holds cash at the fund rate.
//
// Costs are charged per period in the market on the model legs (a round trip
// on the whole book every rebalance, which is harsher than reality); the
// buy-and-hold leg pays nothing. Returns are non-overlapping, so a year of
// results is a year of evidence and not the same month counted twenty times.

import type { PanelPoint } from "./panel";
import type { EodBar } from "@/lib/timeseries/psx-eod";

export type StrategyOptions = {
  horizon: number;
  topShare?: number; // share of names held, by model rank
  cashYieldPct?: number; // annual, while out of the market
  costPct?: number; // per rebalance period in the market, model legs only
  minNames?: number; // names needed on a date for it to count
  breadthFloor?: number; // share of names above their 200-day for "broad"
};

export type StrategyLeg = {
  name: string;
  periods: number;
  totalLogRet: number;
  cagrPct: number;
  maxDrawdownPct: number;
  inMarketPct: number;
  positiveShare: number;
  worstYearPct: number;
  yearly: Record<string, number>; // calendar year -> % return
};

export type StrategyResult = {
  from: string;
  to: string;
  years: number;
  rebalances: number;
  gate1OnPct: number; // index above its 200-day
  gate2OnPct: number; // and breadth at or above the floor
  legs: StrategyLeg[];
};

type Acc = { name: string; log: number; peak: number; dd: number; periods: number; inMarket: number; positive: number; yearly: Record<string, number> };

const acc = (name: string): Acc => ({ name, log: 0, peak: 0, dd: 0, periods: 0, inMarket: 0, positive: 0, yearly: {} });

function add(a: Acc, r: number, year: string, inMarket: boolean) {
  a.log += r;
  a.periods++;
  if (inMarket) a.inMarket++;
  if (r > 0) a.positive++;
  a.yearly[year] = (a.yearly[year] ?? 0) + r;
  if (a.log > a.peak) a.peak = a.log;
  const dd = a.log - a.peak;
  if (dd < a.dd) a.dd = dd;
}

function finish(a: Acc, years: number): StrategyLeg {
  const yearly: Record<string, number> = {};
  let worst = Infinity;
  for (const [y, v] of Object.entries(a.yearly)) {
    const pct = (Math.exp(v) - 1) * 100;
    yearly[y] = pct;
    if (pct < worst) worst = pct;
  }
  return {
    name: a.name,
    periods: a.periods,
    totalLogRet: a.log,
    cagrPct: years > 0 ? (Math.exp(a.log / years) - 1) * 100 : 0,
    maxDrawdownPct: (Math.exp(a.dd) - 1) * 100,
    inMarketPct: a.periods ? (a.inMarket / a.periods) * 100 : 0,
    positiveShare: a.periods ? a.positive / a.periods : 0,
    worstYearPct: Number.isFinite(worst) ? worst : 0,
    yearly,
  };
}

// The 200-day gate per date, from the index the features were built on.
export function indexGate(index: EodBar[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  let sum = 0;
  for (let i = 0; i < index.length; i++) {
    sum += index[i].close;
    if (i >= 200) sum -= index[i - 200].close;
    if (i >= 199) out.set(index[i].date, index[i].close > sum / 200);
  }
  return out;
}

export function strategyBacktest(
  points: PanelPoint[],
  index: EodBar[],
  breadth200: Map<string, number> | null, // date -> share of names above their 200-day (0..1)
  opts: StrategyOptions
): StrategyResult | null {
  const topShare = opts.topShare ?? 0.2;
  const cash = (Math.log(1 + (opts.cashYieldPct ?? 10) / 100) / 252) * opts.horizon;
  const cost = Math.log(1 - (opts.costPct ?? 0.3) / 100);
  const minNames = opts.minNames ?? 20;
  const floor = opts.breadthFloor ?? 0.4;

  const byDi = new Map<number, PanelPoint[]>();
  for (const q of points) {
    const g = byDi.get(q.di);
    if (g) g.push(q);
    else byDi.set(q.di, [q]);
  }
  const dis = [...byDi.keys()].sort((a, b) => a - b);
  if (dis.length === 0) return null;
  const gate = indexGate(index);

  const universe = acc("universe, buy and hold");
  const top = acc("model top fifth, always in");
  const bottom = acc("model bottom fifth (what it says to avoid)");
  const topG1 = acc("model top fifth, only when index above 200d");
  const topG2 = acc("model top fifth, index above 200d and breadth broad");
  const gateOnly = acc("universe only when index above 200d");
  let rebalances = 0, g1On = 0, g2On = 0;
  let from = "", to = "";

  for (let k = 0; k < dis.length; k += opts.horizon) {
    const g = byDi.get(dis[k])!;
    if (g.length < minNames) continue;
    const date = g[0].date;
    const year = date.slice(0, 4);
    if (!from) from = date;
    to = date;
    rebalances++;
    const sorted = [...g].sort((a, b) => b.p[1] - a.p[1]);
    const n = Math.max(1, Math.round(sorted.length * topShare));
    const mean = (arr: PanelPoint[]) => arr.reduce((s, q) => s + q.fwdRet, 0) / arr.length;
    const uRet = mean(g);
    const tRet = mean(sorted.slice(0, n));
    const bRet = mean(sorted.slice(-n));
    const on1 = gate.get(date) ?? false;
    const br = breadth200?.get(date);
    const on2 = on1 && (br == null ? true : br >= floor);
    if (on1) g1On++;
    if (on2) g2On++;

    add(universe, uRet, year, true);
    add(top, tRet + cost, year, true);
    add(bottom, bRet + cost, year, true);
    add(topG1, on1 ? tRet + cost : cash, year, on1);
    add(topG2, on2 ? tRet + cost : cash, year, on2);
    add(gateOnly, on1 ? uRet : cash, year, on1);
  }
  if (rebalances === 0) return null;
  const years = (rebalances * opts.horizon) / 252;
  return {
    from,
    to,
    years,
    rebalances,
    gate1OnPct: (g1On / rebalances) * 100,
    gate2OnPct: (g2On / rebalances) * 100,
    legs: [universe, top, bottom, topG1, topG2, gateOnly].map((a) => finish(a, years)),
  };
}

export function strategyTable(r: StrategyResult): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string | number, n: number) => String(s).padStart(n);
  const pct = (v: number, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
  const lines = [
    `Rule test ${r.from} to ${r.to}: ${r.rebalances} non-overlapping periods, ${r.years.toFixed(1)} years. Index above its 200-day ${r.gate1OnPct.toFixed(0)}% of the time; with breadth broad ${r.gate2OnPct.toFixed(0)}%.`,
    pad("leg", 58) + padL("CAGR", 8) + padL("max DD", 9) + padL("worst yr", 10) + padL("in mkt", 8) + padL("up%", 6),
  ];
  for (const l of r.legs) {
    lines.push(pad(l.name, 58) + padL(pct(l.cagrPct), 8) + padL(pct(l.maxDrawdownPct, 0), 9) + padL(pct(l.worstYearPct, 0), 10) + padL(l.inMarketPct.toFixed(0) + "%", 8) + padL((l.positiveShare * 100).toFixed(0), 6));
  }
  return lines.join("\n");
}

export function strategyYearTable(r: StrategyResult, legs = [0, 1, 4]): string {
  const years = Object.keys(r.legs[0].yearly).sort();
  const pct = (v: number) => ((v >= 0 ? "+" : "") + v.toFixed(0) + "%").padStart(8);
  const head = "year  " + legs.map((i) => r.legs[i].name.slice(0, 22).padStart(24)).join("");
  const rows = years.map((y) => y + "  " + legs.map((i) => pct(r.legs[i].yearly[y] ?? 0).padStart(24)).join(""));
  return [head, ...rows].join("\n");
}
