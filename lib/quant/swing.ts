// Swing trades: a buy level, a stop and two profit levels per name, and the
// record of trading exactly those levels in the past.
//
// The levels come from the zones (projection.ts): the entry is the top of the
// buy zone (or the price, when it already sits inside it), the stop is the
// fail level (only a tenth of paths like this one close below it), the first
// profit level is the bottom of the sell zone (half of paths reach it), the
// second its top (a quarter do). What turns those levels into an edge is not
// the levels themselves, which on their own are a volatility-scaled random
// walk, but WHICH names are traded: the model's rank (the durable signal) and
// the market's state.
//
// The backtest walks the out-of-sample predictions of the walk-forward, day
// by day on closing prices: a limit order at the entry that fills on the first
// close at or under it within `fillWindow` sessions (a name already in its
// zone is bought at the next close, never the close the signal was read on),
// then out on the first close at or under the stop, at or over the target, or
// at the close `horizon` sessions after the fill, whichever comes first. One
// open trade per name at a time, signals read every `stepDays` sessions, a
// round-trip cost charged on every trade.

import type { EodBar } from "@/lib/timeseries/psx-eod";
import { LOW_TARGETS, HIGH_TARGETS, sigmaOverHorizon } from "./features";
import { pathLevels, WALK_CURVE } from "./projection";
import { rankScore, type PanelPoint } from "./panel";

export type SwingLevels = { buyLow: number; buyHigh: number; fails: number; sellLow: number; sellHigh: number };

export type SwingPlan = {
  price: number;
  entry: number; // the limit buy, or the price when already inside the buy zone
  entryNow: boolean;
  stop: number;
  t1: number;
  t2: number;
  riskPct: number; // entry to stop, as a percent of the entry
  rewardPct: number; // entry to the first profit level
  rr: number; // reward over risk, to the first profit level
};

// Null when the price already sits under the stop: the case has failed.
export function swingPlan(price: number, z: SwingLevels): SwingPlan | null {
  if (!(price > 0) || !(z.fails > 0) || price <= z.fails) return null;
  const entryNow = price <= z.buyHigh;
  const entry = entryNow ? price : z.buyHigh;
  if (!(entry > z.fails)) return null;
  const riskPct = ((entry - z.fails) / entry) * 100;
  const rewardPct = ((z.sellLow - entry) / entry) * 100;
  return { price, entry, entryNow, stop: z.fails, t1: z.sellLow, t2: z.sellHigh, riskPct, rewardPct, rr: riskPct > 0 ? rewardPct / riskPct : 0 };
}

export type SwingRule = {
  name: string;
  minPctile: number; // the name's rank on the date, 0..1 (1 = the model's favourite)
  maxPctile?: number;
  strongOnly: boolean; // only when the market index sits above its 200-day
  entry: "zone" | "market";
  target: "t1" | "t2";
};

export type SwingStats = {
  rule: string;
  signals: number;
  trades: number;
  fillRate: number; // share of signals whose order filled
  winRate: number; // trades that closed above their entry, after costs
  hitTarget: number; // share of trades that reached the profit level
  hitStop: number;
  avgRetPct: number; // per trade, after costs
  medianRetPct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number; // gross gains over gross losses
  avgDays: number;
  tradesPerYear: number;
  strong?: { trades: number; winRate: number; avgRetPct: number };
  weak?: { trades: number; winRate: number; avgRetPct: number };
  from: string;
  to: string;
};

export const DEFAULT_SWING_RULES: SwingRule[] = [
  { name: "Top fifth, strong market, buy in the zone, sell at T1", minPctile: 0.8, strongOnly: true, entry: "zone", target: "t1" },
  { name: "Top fifth, strong market, buy in the zone, sell at T2", minPctile: 0.8, strongOnly: true, entry: "zone", target: "t2" },
  { name: "Top fifth, strong market, buy at market, sell at T1", minPctile: 0.8, strongOnly: true, entry: "market", target: "t1" },
  { name: "Top fifth, any market, buy in the zone, sell at T1", minPctile: 0.8, strongOnly: false, entry: "zone", target: "t1" },
  { name: "Top tenth, strong market, buy in the zone, sell at T1", minPctile: 0.9, strongOnly: true, entry: "zone", target: "t1" },
  { name: "Every name, any market, buy in the zone, sell at T1 (no model)", minPctile: 0, strongOnly: false, entry: "zone", target: "t1" },
  { name: "Bottom fifth, any market, buy in the zone, sell at T1 (what it says to avoid)", minPctile: 0, maxPctile: 0.2, strongOnly: false, entry: "zone", target: "t1" },
];

// The rule's levels for one point: its own path curve over its own volatility.
function levelsFor(bars: EodBar[], i: number, horizon: number, p: number[], walk: boolean): SwingLevels | null {
  if (i < 61) return null;
  let m = 0;
  for (let k = i - 59; k <= i; k++) m += Math.log(bars[k].close / bars[k - 1].close);
  m /= 60;
  let v = 0;
  for (let k = i - 59; k <= i; k++) v += (Math.log(bars[k].close / bars[k - 1].close) - m) ** 2;
  const sigmaH = sigmaOverHorizon(Math.sqrt(v / 60), horizon);
  const lv = walk ? pathLevels(bars[i].close, sigmaH, WALK_CURVE, WALK_CURVE) : pathLevels(bars[i].close, sigmaH, LOW_TARGETS.map((t) => p[t]), HIGH_TARGETS.map((t) => p[t]));
  return { buyLow: lv.buyLow, buyHigh: lv.buyHigh, fails: lv.fails, sellLow: lv.sellLow, sellHigh: lv.sellHigh };
}

function dateIndex(bars: EodBar[], date: string): number {
  let lo = 0, hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date === date) return mid;
    if (bars[mid].date < date) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function swingBacktest(
  points: PanelPoint[],
  bars: Map<string, EodBar[]>,
  gate: Map<string, boolean>, // date -> index above its 200-day
  horizon: number,
  rules: SwingRule[] = DEFAULT_SWING_RULES,
  o: { stepDays?: number; fillWindow?: number; costPct?: number; walkLevels?: boolean } = {}
): SwingStats[] {
  const step = o.stepDays ?? 5;
  const fillWindow = o.fillWindow ?? 5;
  const cost = (o.costPct ?? 0.4) / 100;
  const walk = o.walkLevels ?? false;
  const havePaths = points.some((q) => q.p.length > HIGH_TARGETS[2] && Number.isFinite(q.p[HIGH_TARGETS[2]]));
  if (!havePaths && !walk) return [];

  // Each point's rank on its date.
  const byDi = new Map<number, PanelPoint[]>();
  for (const q of points) {
    const g = byDi.get(q.di);
    if (g) g.push(q);
    else byDi.set(q.di, [q]);
  }
  const pctile = new Map<PanelPoint, number>();
  for (const g of byDi.values()) {
    const s = [...g].sort((a, b) => rankScore(a.p) - rankScore(b.p));
    s.forEach((q, k) => pctile.set(q, s.length > 1 ? k / (s.length - 1) : 0.5));
  }
  const dis = [...byDi.keys()].sort((a, b) => a - b);
  const first = dis[0] ?? 0;

  return rules.map((rule) => {
    const busyUntil = new Map<string, string>(); // one open trade per name
    const rets: number[] = [];
    const days: number[] = [];
    let signals = 0, targets = 0, stops = 0;
    const byState = { strong: [] as number[], weak: [] as number[] };
    let from = "", to = "";
    for (const di of dis) {
      if ((di - first) % step !== 0) continue;
      for (const q of byDi.get(di)!) {
        const pc = pctile.get(q)!;
        if (pc < rule.minPctile || (rule.maxPctile != null && pc > rule.maxPctile)) continue;
        const strong = gate.get(q.date) === true;
        if (rule.strongOnly && !strong) continue;
        const b = bars.get(q.symbol);
        if (!b) continue;
        const busy = busyUntil.get(q.symbol);
        if (busy && busy >= q.date) continue;
        const i = dateIndex(b, q.date);
        if (i < 0 || i + 2 >= b.length) continue;
        const z = levelsFor(b, i, horizon, q.p, walk);
        if (!z) continue;
        const plan = swingPlan(b[i].close, z);
        if (!plan) continue;
        signals++;
        if (!from) from = q.date;
        to = q.date;
        // The fill: the next close for a market order or a name already in its
        // zone; otherwise the first close at or under the limit.
        let f = -1;
        if (rule.entry === "market" || plan.entryNow) f = i + 1;
        else for (let k = i + 1; k <= Math.min(b.length - 1, i + fillWindow); k++) if (b[k].close <= plan.entry) { f = k; break; }
        if (f < 0 || f >= b.length) continue;
        const fill = b[f].close;
        const target = rule.target === "t1" ? plan.t1 : plan.t2;
        let exit = -1, how: "target" | "stop" | "time" = "time";
        const last = Math.min(b.length - 1, f + horizon);
        for (let k = f + 1; k <= last; k++) {
          if (b[k].close <= plan.stop) { exit = k; how = "stop"; break; }
          if (b[k].close >= target) { exit = k; how = "target"; break; }
        }
        if (exit < 0) exit = last;
        if (exit <= f) continue;
        const r = Math.log(b[exit].close / fill) - cost;
        rets.push(r);
        days.push(exit - f);
        if (how === "target") targets++;
        if (how === "stop") stops++;
        (strong ? byState.strong : byState.weak).push(r);
        busyUntil.set(q.symbol, b[exit].date);
      }
    }
    const n = rets.length;
    const pct = (x: number) => (Math.exp(x) - 1) * 100;
    const wins = rets.filter((r) => r > 0), losses = rets.filter((r) => r <= 0);
    const sorted = [...rets].sort((a, b) => a - b);
    const gross = (arr: number[]) => arr.reduce((s, r) => s + Math.abs(pct(r)), 0);
    const years = from && to ? Math.max(0.5, (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000)) : 1;
    const sub = (arr: number[]) => ({ trades: arr.length, winRate: arr.length ? arr.filter((r) => r > 0).length / arr.length : 0, avgRetPct: arr.length ? arr.reduce((s, r) => s + pct(r), 0) / arr.length : 0 });
    return {
      rule: rule.name,
      signals,
      trades: n,
      fillRate: signals ? n / signals : 0,
      winRate: n ? wins.length / n : 0,
      hitTarget: n ? targets / n : 0,
      hitStop: n ? stops / n : 0,
      avgRetPct: n ? rets.reduce((s, r) => s + pct(r), 0) / n : 0,
      medianRetPct: n ? pct(sorted[Math.floor(n / 2)]) : 0,
      avgWinPct: wins.length ? wins.reduce((s, r) => s + pct(r), 0) / wins.length : 0,
      avgLossPct: losses.length ? losses.reduce((s, r) => s + pct(r), 0) / losses.length : 0,
      profitFactor: gross(losses) > 0 ? gross(wins) / gross(losses) : 0,
      avgDays: n ? days.reduce((s, d) => s + d, 0) / n : 0,
      tradesPerYear: n / years,
      strong: sub(byState.strong),
      weak: sub(byState.weak),
      from,
      to,
    };
  });
}

export function swingTable(stats: SwingStats[]): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string | number, n: number) => String(s).padStart(n);
  const pct = (v: number, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
  const lines = [pad("swing rule", 78) + padL("trades", 8) + padL("/yr", 6) + padL("fill", 6) + padL("win", 6) + padL("target", 8) + padL("stop", 6) + padL("avg", 8) + padL("median", 8) + padL("PF", 6) + padL("days", 6)];
  for (const s of stats) {
    lines.push(
      pad(s.rule, 78) + padL(s.trades, 8) + padL(s.tradesPerYear.toFixed(0), 6) + padL((s.fillRate * 100).toFixed(0) + "%", 6) + padL((s.winRate * 100).toFixed(0) + "%", 6) +
        padL((s.hitTarget * 100).toFixed(0) + "%", 8) + padL((s.hitStop * 100).toFixed(0) + "%", 6) + padL(pct(s.avgRetPct, 2), 8) + padL(pct(s.medianRetPct, 2), 8) + padL(s.profitFactor.toFixed(2), 6) + padL(s.avgDays.toFixed(1), 6)
    );
  }
  return lines.join("\n");
}
