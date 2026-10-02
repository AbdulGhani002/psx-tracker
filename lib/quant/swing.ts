// Swing trades: a buy level, a stop and two profit levels per name, and the
// record of trading exactly those levels in the past.
//
// The levels come from the zones (projection.ts): the stop is the fail level
// (only a tenth of paths like this one close below it), the first profit level
// is the bottom of the sell zone (half of paths reach it), the second its top
// (a quarter do). The entry is the next close. Waiting for the top of the buy
// zone was tested too and lost: on the 24-year walk-forward a limit there
// filled on one signal in ten, and the dips that filled it were the ones that
// kept going (41% of those trades hit the stop, 45% made money, +0.48% a
// trade), where buying the same names at the next close made money on 61% of
// trades and +0.96% a trade, with 9% stopped out. What turns those levels into an edge is not
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
// "market" buys at the price; "zone" waits for the top of the buy zone.
export function swingPlan(price: number, z: SwingLevels, mode: "market" | "zone" = "market"): SwingPlan | null {
  if (!(price > 0) || !(z.fails > 0) || price <= z.fails) return null;
  const entryNow = mode === "market" || price <= z.buyHigh;
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
  // Volatility-scaled levels instead of the zones: the stop `stopSigma` of the
  // name's own horizon volatility under the fill, the target `targetR` times
  // that distance over it (so targetR IS the reward-to-risk), and out after
  // `maxHold` sessions whatever happened.
  stopSigma?: number;
  targetR?: number;
  maxHold?: number;
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
  // The average trade in the first and second half of the dates, for whether
  // a rule held up or only worked once.
  halves?: [number, number];
  rr?: number;
  maxHold?: number;
  stopPct?: number; // average distance to the stop, % of the entry
  from: string;
  to: string;
};

// The first rule is the one the Swing trades page follows; the rest are there
// to show what it is worth against: the same trade without the model, on the
// names the model says to avoid, in any market, and waiting for a dip.
export const DEFAULT_SWING_RULES: SwingRule[] = [
  { name: "Top fifth, strong market, buy at the next close, sell at T1", minPctile: 0.8, strongOnly: true, entry: "market", target: "t1" },
  { name: "Top fifth, strong market, buy at the next close, sell at T2", minPctile: 0.8, strongOnly: true, entry: "market", target: "t2" },
  { name: "Top tenth, strong market, buy at the next close, sell at T1", minPctile: 0.9, strongOnly: true, entry: "market", target: "t1" },
  { name: "Top fifth, any market, buy at the next close, sell at T1", minPctile: 0.8, strongOnly: false, entry: "market", target: "t1" },
  { name: "Every name, strong market, buy at the next close, sell at T1 (no model)", minPctile: 0, strongOnly: true, entry: "market", target: "t1" },
  { name: "Bottom fifth, strong market, buy at the next close, sell at T1 (what it says to avoid)", minPctile: 0, maxPctile: 0.2, strongOnly: true, entry: "market", target: "t1" },
  { name: "Top fifth, strong market, wait for the buy zone, sell at T1", minPctile: 0.8, strongOnly: true, entry: "zone", target: "t1" },
];

// The name's volatility over the horizon, from its last 60 sessions.
export function sigmaHAt(bars: Array<{ close: number }>, i: number, horizon: number): number | null {
  if (i < 61) return null;
  let m = 0;
  for (let k = i - 59; k <= i; k++) m += Math.log(bars[k].close / bars[k - 1].close);
  m /= 60;
  let v = 0;
  for (let k = i - 59; k <= i; k++) v += (Math.log(bars[k].close / bars[k - 1].close) - m) ** 2;
  return sigmaOverHorizon(Math.sqrt(v / 60), horizon);
}

// The rule's levels for one point: its own path curve over its own volatility.
function levelsFor(bars: EodBar[], i: number, horizon: number, p: number[], walk: boolean): SwingLevels | null {
  const sigmaH = sigmaHAt(bars, i, horizon);
  if (sigmaH == null) return null;
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
    const retDates: string[] = [];
    const stopDist: number[] = [];
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
        const plan = swingPlan(b[i].close, z, rule.entry);
        if (!plan) continue;
        signals++;
        if (!from) from = q.date;
        to = q.date;
        // The fill: the next close for a market order or a name already in its
        // zone; otherwise the first close at or under the limit.
        let f = -1;
        if (plan.entryNow) f = i + 1;
        else for (let k = i + 1; k <= Math.min(b.length - 1, i + fillWindow); k++) if (b[k].close <= plan.entry) { f = k; break; }
        if (f < 0 || f >= b.length) continue;
        const fill = b[f].close;
        let target = rule.target === "t1" ? plan.t1 : plan.t2;
        let stop = plan.stop;
        if (rule.stopSigma != null) {
          const sH = sigmaHAt(b, i, horizon)!;
          stop = fill * Math.exp(-rule.stopSigma * sH);
          target = fill * Math.exp((rule.targetR ?? 1) * rule.stopSigma * sH);
          stopDist.push((1 - stop / fill) * 100);
        }
        let exit = -1, how: "target" | "stop" | "time" = "time";
        const last = Math.min(b.length - 1, f + (rule.maxHold ?? horizon));
        for (let k = f + 1; k <= last; k++) {
          if (b[k].close <= stop) { exit = k; how = "stop"; break; }
          if (b[k].close >= target) { exit = k; how = "target"; break; }
        }
        if (exit < 0) exit = last;
        if (exit <= f) continue;
        const r = Math.log(b[exit].close / fill) - cost;
        rets.push(r);
        retDates.push(q.date);
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
    const mid = dis.length ? dis[Math.floor(dis.length / 2)] : 0;
    const midDate = byDi.get(mid)?.[0]?.date ?? "";
    const half = (first: boolean) => {
      const xs = rets.filter((_, k) => (retDates[k] < midDate) === first);
      return xs.length ? xs.reduce((s2, r) => s2 + pct(r), 0) / xs.length : 0;
    };
    return {
      rule: rule.name,
      halves: [half(true), half(false)],
      rr: rule.stopSigma != null ? rule.targetR ?? 1 : undefined,
      maxHold: rule.maxHold ?? horizon,
      stopPct: stopDist.length ? stopDist.reduce((s2, v) => s2 + v, 0) / stopDist.length : undefined,
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

// ---------------------------------------------------------------------------
// The book: what the Swing trades page runs, day by day. A fixed number of
// slots. On a day a slot is free and the market is strong, the best-ranked
// names not already in the book are bought at the next close. Each trade gets
// its stop, its target and its sell-by date at the fill, and nothing moves
// them afterwards: out on the first close at or under the stop, at or over the
// target, or on the sell-by date at whatever the price is, which frees the
// slot for the next trade. The same functions run the live book and its
// backtest, so the record on the page is the record of this code.

export type BookRule = {
  minPctile: number; // the rank floor: 0.9 is the model's top tenth
  strongOnly: boolean; // new trades only while the market is above its 200-day
  stopSigma: number; // the stop, in the name's own volatility over the horizon
  targetR: number; // the target, as a multiple of the risk: the reward-to-risk
  maxHold: number; // sessions to the sell-by date
  slots: number;
  cooldown: number; // sessions after an exit before the same name can come back
  costPct: number; // round trip
  horizon: number; // the volatility's horizon, the model's
  pendingDays: number; // a buy that has not filled in this many sessions is dropped
};

// Chosen on the 24-year walk-forward's out-of-sample ranks (scripts/swing-rules.ts
// --grid, then --book --grid2): five slots, the stop one horizon-sigma under
// the fill (8% on average), the target twice as far over it, out by the 15th
// session, and a name sold sits out two weeks so the book rotates instead of
// buying back what it just sold. 2007 to 2026: +17.8% a year, worst fall -27%,
// 54% of 1,064 trades made money; the same book on random names made +6% a
// year with falls of 46% to 63%. The neighbouring rules made 15% to 19%, so
// this one is not a lucky corner of the grid.
export const SWING_BOOK_RULE: BookRule = { minPctile: 0.9, strongOnly: true, stopSigma: 1, targetR: 2, maxHold: 15, slots: 5, cooldown: 10, costPct: 0.4, horizon: 20, pendingDays: 5 };

// What the page prints as the rule's record: the backtest of the book, the
// same book on random names, and when and on what it was run.
export type SwingTested = {
  stats: BookStats;
  random: { cagrPct: number; winRate: number; avgRetPct: number; maxDrawdownPct: number; draws: number };
  indexCagrPct: number | null;
  builtAt: string;
};

export type BookTrade = {
  symbol: string;
  status: "pending" | "open" | "closed" | "dropped";
  signalDate: string;
  signalClose: number;
  pctile: number;
  sigmaH: number;
  entryDate?: string;
  entryPrice?: number;
  stop?: number;
  target?: number;
  sellBy?: string;
  exitDate?: string;
  exitPrice?: number;
  exitReason?: "target" | "stop" | "time";
  returnPct?: number; // after the round-trip cost
  lastDate?: string;
  lastClose?: number;
  sessions?: number; // sessions held so far
};

// The date `n` weekdays after `date`: a sell-by the page can print on the day
// of the buy. A holiday in between makes the hold a session shorter.
export function addSessions(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) k++;
  }
  return d.toISOString().slice(0, 10);
}

// Weekdays from one date to another (0 on the same day, negative if past).
export function sessionsBetween(from: string, to: string): number {
  if (to === from) return 0;
  const sign = to > from ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  const d = new Date(a + "T00:00:00Z");
  let k = 0;
  while (d.toISOString().slice(0, 10) < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) k++;
  }
  return sign * k;
}

export function bookLevels(price: number, sigmaH: number, rule: BookRule): { stop: number; target: number; riskPct: number; rewardPct: number } {
  const stop = price * Math.exp(-rule.stopSigma * sigmaH);
  const target = price * Math.exp(rule.targetR * rule.stopSigma * sigmaH);
  return { stop, target, riskPct: (1 - stop / price) * 100, rewardPct: (target / price - 1) * 100 };
}

// One session's close for one trade: fills a pending buy at it, or closes an
// open trade on its stop, its target or its sell-by. Closes on or before the
// signal (or the last one seen) are ignored, so feeding a day twice is safe.
export function stepTrade(t: BookTrade, bar: { date: string; close: number }, rule: BookRule): void {
  if (t.status === "closed" || t.status === "dropped" || !(bar.close > 0)) return;
  if (t.status === "pending") {
    if (bar.date <= t.signalDate) return;
    const lv = bookLevels(bar.close, t.sigmaH, rule);
    t.status = "open";
    t.entryDate = bar.date;
    t.entryPrice = bar.close;
    t.stop = lv.stop;
    t.target = lv.target;
    t.sellBy = addSessions(bar.date, rule.maxHold);
    t.lastDate = bar.date;
    t.lastClose = bar.close;
    t.sessions = 0;
    return;
  }
  if (bar.date <= (t.lastDate ?? t.entryDate ?? t.signalDate)) return;
  t.lastDate = bar.date;
  t.lastClose = bar.close;
  t.sessions = (t.sessions ?? 0) + 1;
  const how = bar.close <= t.stop! ? "stop" : bar.close >= t.target! ? "target" : bar.date >= t.sellBy! ? "time" : null;
  if (how) {
    t.status = "closed";
    t.exitDate = bar.date;
    t.exitPrice = bar.close;
    t.exitReason = how;
    t.returnPct = tradeReturnPct(t.entryPrice!, bar.close, rule.costPct);
  }
}

const isoDaysBefore = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export const tradeReturnPct = (entry: number, exit: number, costPct: number) => ((exit / entry) * Math.exp(-costPct / 100) - 1) * 100;

export type BookCandidate = { symbol: string; pctile: number; close: number; sigmaH: number | null };

// The names to buy: the best ranked at or over the floor, not in the book and
// not out of it too recently, as many as there are free slots.
export function pickTrades(cands: BookCandidate[], book: BookTrade[], date: string, rule: BookRule): BookCandidate[] {
  const busy = new Set(book.filter((t) => t.status === "pending" || t.status === "open").map((t) => t.symbol));
  const free = rule.slots - busy.size;
  if (free <= 0) return [];
  let cooling = new Set<string>();
  if (rule.cooldown > 0) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - Math.ceil(rule.cooldown * 1.5) - 7);
    const cutoff = d.toISOString().slice(0, 10);
    cooling = new Set(book.filter((t) => t.status === "closed" && t.exitDate && t.exitDate >= cutoff && sessionsBetween(t.exitDate, date) < rule.cooldown).map((t) => t.symbol));
  }
  return cands
    .filter((c) => c.pctile >= rule.minPctile && !busy.has(c.symbol) && !cooling.has(c.symbol) && c.close > 0 && c.sigmaH != null && c.sigmaH > 0)
    .sort((a, b) => b.pctile - a.pctile)
    .slice(0, free);
}

export function newTrade(c: BookCandidate, date: string): BookTrade {
  return { symbol: c.symbol, status: "pending", signalDate: date, signalClose: c.close, pctile: c.pctile, sigmaH: c.sigmaH! };
}

export type BookStats = {
  rule: BookRule;
  trades: number;
  tradesPerYear: number;
  winRate: number;
  avgRetPct: number;
  medianRetPct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  hitTarget: number;
  hitStop: number;
  hitTime: number;
  avgDays: number;
  cagrPct: number; // the whole book, every slot, marked to market daily
  maxDrawdownPct: number;
  exposurePct: number; // average share of the book in trades
  halves: [number, number]; // the average trade, first and second half of the dates
  cagrHalves: [number, number]; // the book's yearly return, first and second half
  years: Array<{ year: number; retPct: number; trades: number }>;
  from: string;
  to: string;
};

// `shuffleSeed` replaces the model's rank with a random one: the same book
// without the model, to measure what the model adds.
export function swingBookBacktest(points: PanelPoint[], bars: Map<string, EodBar[]>, gate: Map<string, boolean>, rule: BookRule = SWING_BOOK_RULE, o: { shuffleSeed?: number; onDay?: (date: string, equity: number, open: string[]) => void } = {}): BookStats {
  const byDi = new Map<number, PanelPoint[]>();
  for (const q of points) {
    const g = byDi.get(q.di);
    if (g) g.push(q);
    else byDi.set(q.di, [q]);
  }
  const pctile = new Map<PanelPoint, number>();
  let seed = o.shuffleSeed ?? 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const g of byDi.values()) {
    const s = o.shuffleSeed != null ? [...g].map((q) => ({ q, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.q) : [...g].sort((a, b) => rankScore(a.p) - rankScore(b.p));
    s.forEach((q, k) => pctile.set(q, s.length > 1 ? k / (s.length - 1) : 0.5));
  }
  const dis = [...byDi.keys()].sort((a, b) => a - b);
  const midDi = dis[Math.floor(dis.length / 2)];
  let midEquity = 1, midDate = "";
  const book: BookTrade[] = [];
  let active: BookTrade[] = [];
  const recent: BookTrade[] = []; // what pickTrades needs to see: in play, or closed lately
  const alloc = new Map<BookTrade, number>();
  let cash = 1, peak = 1, maxDD = 0, expSum = 0, days = 0;
  const yearEnd = new Map<number, number>();
  const yearTrades = new Map<number, number>();
  let from = "", to = "";
  for (const di of dis) {
    const g = byDi.get(di)!;
    const date = g[0].date;
    if (!from) from = date;
    to = date;
    // The day's closes: fills first, then exits.
    let marked = 0;
    for (const t of active) {
      const b = bars.get(t.symbol);
      const k = b ? dateIndex(b, date) : -1;
      if (t.status === "pending" && sessionsBetween(t.signalDate, date) > rule.pendingDays) {
        t.status = "dropped";
        continue;
      }
      if (k < 0) continue;
      const wasPending = t.status === "pending";
      stepTrade(t, b![k], rule);
      if (wasPending && t.status === "open") {
        let equity = cash;
        for (const [u, a] of alloc) equity += a * (u.lastClose! / u.entryPrice!);
        const a = Math.min(cash, equity / rule.slots);
        cash -= a;
        alloc.set(t, a);
      }
      if (t.status === "closed") {
        const a = alloc.get(t) ?? 0;
        cash += a * (t.exitPrice! / t.entryPrice!) * Math.exp(-rule.costPct / 100);
        alloc.delete(t);
        const y = Number(t.exitDate!.slice(0, 4));
        yearTrades.set(y, (yearTrades.get(y) ?? 0) + 1);
      }
    }
    active = active.filter((t) => t.status === "pending" || t.status === "open");
    for (const [u, a] of alloc) marked += a * (u.lastClose! / u.entryPrice!);
    const equity = cash + marked;
    o.onDay?.(date, equity, [...alloc.keys()].map((u) => u.symbol));
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity / peak - 1);
    expSum += equity > 0 ? marked / equity : 0;
    days++;
    yearEnd.set(Number(date.slice(0, 4)), equity);
    if (di === midDi) {
      midEquity = equity;
      midDate = date;
    }
    // The evening's picks, bought at the next close.
    if (rule.strongOnly && gate.get(date) !== true) continue;
    const cands: BookCandidate[] = [];
    for (const q of g) {
      const pc = pctile.get(q)!;
      if (pc < rule.minPctile) continue;
      const b = bars.get(q.symbol);
      const k = b ? dateIndex(b, date) : -1;
      if (k < 0) continue;
      cands.push({ symbol: q.symbol, pctile: pc, close: b![k].close, sigmaH: sigmaHAt(b!, k, rule.horizon) });
    }
    // Closed trades older than the cooldown can no longer matter to a pick.
    while (recent.length > 0 && recent[0].status !== "pending" && recent[0].status !== "open" && (recent[0].exitDate ?? recent[0].signalDate) < isoDaysBefore(date, rule.cooldown * 2 + 10)) recent.shift();
    for (const c of pickTrades(cands, [...active, ...recent.filter((t) => t.status === "closed")], date, rule)) {
      const t = newTrade(c, date);
      book.push(t);
      active.push(t);
      recent.push(t);
    }
  }
  const closed = book.filter((t) => t.status === "closed");
  const rets = closed.map((t) => t.returnPct!);
  const n = rets.length;
  const wins = rets.filter((r) => r > 0), losses = rets.filter((r) => r <= 0);
  const sum = (a: number[]) => a.reduce((s2, v) => s2 + v, 0);
  const sorted = [...rets].sort((a, b) => a - b);
  const span = from && to ? Math.max(0.5, (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000)) : 1;
  const final = [...yearEnd.values()].pop() ?? 1;
  const mid = dis.length ? byDi.get(dis[Math.floor(dis.length / 2)])![0].date : "";
  const half = (first: boolean) => {
    const xs = closed.filter((t) => (t.signalDate < mid) === first).map((t) => t.returnPct!);
    return xs.length ? sum(xs) / xs.length : 0;
  };
  const years: BookStats["years"] = [];
  let prevEq = 1;
  for (const [y, eq] of [...yearEnd].sort((a, b) => a[0] - b[0])) {
    years.push({ year: y, retPct: (eq / prevEq - 1) * 100, trades: yearTrades.get(y) ?? 0 });
    prevEq = eq;
  }
  return {
    rule,
    trades: n,
    tradesPerYear: n / span,
    winRate: n ? wins.length / n : 0,
    avgRetPct: n ? sum(rets) / n : 0,
    medianRetPct: n ? sorted[Math.floor(n / 2)] : 0,
    avgWinPct: wins.length ? sum(wins) / wins.length : 0,
    avgLossPct: losses.length ? sum(losses) / losses.length : 0,
    profitFactor: losses.length && sum(losses) !== 0 ? sum(wins) / Math.abs(sum(losses)) : 0,
    hitTarget: n ? closed.filter((t) => t.exitReason === "target").length / n : 0,
    hitStop: n ? closed.filter((t) => t.exitReason === "stop").length / n : 0,
    hitTime: n ? closed.filter((t) => t.exitReason === "time").length / n : 0,
    avgDays: n ? sum(closed.map((t) => t.sessions ?? 0)) / n : 0,
    cagrPct: (Math.pow(final, 1 / span) - 1) * 100,
    maxDrawdownPct: maxDD * 100,
    exposurePct: days ? (expSum / days) * 100 : 0,
    halves: [half(true), half(false)],
    cagrHalves: [
      midDate ? (Math.pow(midEquity, 365.25 * 86400000 / Math.max(1, Date.parse(midDate) - Date.parse(from))) - 1) * 100 : 0,
      midDate ? (Math.pow(final / midEquity, 365.25 * 86400000 / Math.max(1, Date.parse(to) - Date.parse(midDate))) - 1) * 100 : 0,
    ],
    years,
    from,
    to,
  };
}
