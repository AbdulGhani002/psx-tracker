// Do the rules actually work? Run them against the record and find out.
//
// The ladder and the regime scorecard both claim something testable: that
// buying to a written plan beats buying whenever money happens to arrive. This
// file is the test. It walks a daily index series one day at a time, gives every
// strategy the SAME money on the SAME days, and reports what each was worth at
// the end.
//
// Three things make the answer honest rather than flattering:
//
//   1. Cash earns. In Pakistan a money-market fund pays double digits, so
//      waiting is not free but it is nowhere near costless either. A backtest
//      that pays nothing on cash makes every "wait" rule look worse than it is;
//      one that ignores the fund makes it look better. Both are lies, so the
//      daily yield is accrued explicitly and you set the rate.
//
//   2. Rungs are measured as a FALL FROM THE RUNNING HIGH, not as index levels.
//      A ladder written at 168,000 means nothing in 2022. "Buy after an 8% fall"
//      is the same rule expressed so it can be tested across years, and it is
//      what the levels on your ladder actually encode.
//
//   3. Every strategy is charged the same contributions at the same time and
//      judged on money-weighted return, so none can win by being handed its
//      money at a luckier moment.
//
// What this CANNOT tell you: the regime score here is built from the index
// alone (trend against the 200-day average, and the 50/200 cross), because those
// are the only two signals reconstructible from price history. Oil, the rupee,
// the policy rate, foreign flows and politics are not in it. So the regime
// result is a floor on what the full scorecard would do, not a measure of it.
//
// Pure arithmetic. No fetching, no dates beyond the ones in the series.

import { scoreTrend200, scoreCross, scoreRegime, type RegimeSignal } from "./regime";
import { xirr, type CashFlow } from "./xirr";

export type Bar = { date: string; close: number };

export type BacktestRung = {
  fallPct: number; // fall from the running high that arms this rung, e.g. 8
  pct: number; // share of the pool this rung spends
  label?: string;
};

export type BacktestConfig = {
  startCash: number;
  monthlyContribution: number;
  cashYieldPct: number; // annual, accrued daily on idle cash
  rungs: BacktestRung[];
  reservePct: number; // never spent by the ladder
  rearmWithinPct: number; // recovery to within this much of the high re-arms
  costPct: number; // friction on a buy, in per cent
};

export type StrategyKey = "alwaysIn" | "ladder" | "ladderRegime" | "cashOnly";

export type Trade = {
  date: string;
  level: number; // index level the buy went in at
  amount: number;
  reason: string;
};

export type CurvePoint = { date: string; value: number; equityPct: number };

export type StrategyResult = {
  key: StrategyKey;
  label: string;
  finalValue: number;
  contributed: number;
  profit: number;
  returnPct: number; // simple, on money put in
  xirrPct: number | null; // money-weighted annual, the comparable number
  maxDrawdownPct: number; // worst peak-to-trough of the PORTFOLIO, not the index
  buys: number;
  deployed: number; // rupees that actually went into equities
  avgBuyLevel: number; // amount-weighted index level of the buys
  avgTimeInvestedPct: number; // average share of the portfolio held in equities
  endCash: number;
  endEquity: number;
  curve: CurvePoint[];
};

export type BacktestResult = {
  from: string;
  to: string;
  years: number;
  bars: number;
  indexStart: number;
  indexEnd: number;
  indexReturnPct: number;
  indexMaxDrawdownPct: number;
  avgIndexLevel: number;
  config: BacktestConfig;
  strategies: StrategyResult[];
  verdict: string;
  notes: string[];
};

export const DEFAULT_CONFIG: BacktestConfig = {
  startCash: 100000,
  monthlyContribution: 25000,
  cashYieldPct: 11,
  rungs: [
    { fallPct: 4, pct: 20, label: "first dip" },
    { fallPct: 8, pct: 25, label: "real fall" },
    { fallPct: 14, pct: 25, label: "deep" },
    { fallPct: 22, pct: 30, label: "washout" },
  ],
  reservePct: 10,
  rearmWithinPct: 2,
  costPct: 0.3,
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const day = (iso: string) => new Date(iso + "T00:00:00Z").getTime();
const DAY_MS = 86400000;

// --- one strategy's running state ------------------------------------------

type Book = {
  cash: number;
  units: number; // index units, fractional: this is a model, not an order
  trades: Trade[];
  curve: CurvePoint[];
  // Drawdown is measured on a synthetic UNIT PRICE, not on the rupee balance.
  // An account taking a contribution every month keeps growing in rupees while
  // its holdings fall, so peak-to-trough on the balance can read 0% through a
  // 45% bear market. Contributions issue units at the price of the day and move
  // the unit price not at all, which is the same trick a fund uses to report
  // performance separately from flows.
  shareUnits: number;
  sharePrice: number;
  peakSharePrice: number;
  maxDdPct: number;
  investedSum: number; // running total for the time-weighted equity share
  investedDays: number;
  poolAtArming: number;
  fired: boolean[];
};

const newBook = (cash: number, rungCount: number): Book => ({
  cash,
  units: 0,
  trades: [],
  curve: [],
  shareUnits: cash > 0 ? cash : 1,
  sharePrice: 1,
  peakSharePrice: 1,
  maxDdPct: 0,
  investedSum: 0,
  investedDays: 0,
  poolAtArming: cash,
  fired: new Array(rungCount).fill(false),
});

const bookValue = (b: Book, close: number) => b.units * close + b.cash;

// New money buys units at today's price, so it lifts the balance without ever
// flattering or denting the return.
function contribute(b: Book, amount: number, close: number) {
  if (!(amount > 0)) return;
  reprice(b, close);
  if (b.sharePrice > 0) b.shareUnits += amount / b.sharePrice;
  b.cash += amount;
}

function reprice(b: Book, close: number) {
  if (b.shareUnits > 0) b.sharePrice = bookValue(b, close) / b.shareUnits;
}

function markToMarket(b: Book, close: number, date: string, record: boolean) {
  const equity = b.units * close;
  const value = equity + b.cash;
  reprice(b, close);
  if (b.sharePrice > b.peakSharePrice) b.peakSharePrice = b.sharePrice;
  const dd = b.peakSharePrice > 0 ? ((b.sharePrice - b.peakSharePrice) / b.peakSharePrice) * 100 : 0;
  if (dd < b.maxDdPct) b.maxDdPct = dd;
  b.investedSum += value > 0 ? (equity / value) * 100 : 0;
  b.investedDays += 1;
  if (record) b.curve.push({ date, value, equityPct: value > 0 ? (equity / value) * 100 : 0 });
}

function buy(b: Book, amount: number, close: number, date: string, reason: string, costPct: number) {
  if (!(amount > 0) || !(close > 0)) return;
  const spend = Math.min(amount, b.cash);
  if (spend <= 0) return;
  const net = spend * (1 - costPct / 100);
  b.units += net / close;
  b.cash -= spend;
  b.trades.push({ date, level: close, amount: spend, reason });
}

// --- the regime score a price series alone can support ----------------------
// Two signals, both from the index. Turned into a cash floor by exactly the
// same function the live scorecard uses, so the backtest and the app cannot
// drift apart as the bands are tuned.

export function regimeFloorFromIndex(
  close: number,
  ma50: number,
  ma200: number,
  ma200SlopePct: number
): number {
  const signals: RegimeSignal[] = [];
  if (ma200 > 0) {
    const t = scoreTrend200(close, ma200, ma200SlopePct);
    signals.push({ key: "trend200", label: "trend", source: "auto", known: true, hint: "", ...t });
    const c = scoreCross(ma50, ma200);
    signals.push({ key: "cross", label: "cross", source: "auto", known: true, hint: "", ...c });
  }
  return scoreRegime(signals).cashFloorPct;
}

// --- the run ----------------------------------------------------------------

export function runBacktest(series: Bar[], cfgIn: Partial<BacktestConfig> = {}): BacktestResult {
  const config: BacktestConfig = { ...DEFAULT_CONFIG, ...cfgIn };
  const bars = (series ?? [])
    .filter((b) => b && typeof b.date === "string" && num(b.close) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const notes: string[] = [];
  if (bars.length < 260) {
    return emptyResult(config, bars, ["Not enough history to test. A year of daily closes is the minimum."]);
  }

  const rungs = [...(config.rungs ?? [])]
    .map((r) => ({ fallPct: Math.abs(num(r.fallPct)), pct: Math.max(0, num(r.pct)), label: r.label ?? "" }))
    .filter((r) => r.fallPct > 0 && r.pct > 0)
    .sort((a, b) => a.fallPct - b.fallPct); // shallowest first: the order they arm

  if (rungs.length === 0) notes.push("No rungs set, so the ladder never buys. It shows here as pure cash.");
  const allocated = rungs.reduce((s, r) => s + r.pct, 0);
  if (allocated > 100.0001) {
    notes.push("Rungs add to " + allocated.toFixed(0) + "% of the pool. Anything over 100% cannot be funded.");
  }

  const closes = bars.map((b) => b.close);
  const dailyYield = Math.pow(1 + config.cashYieldPct / 100, 1 / 365) - 1;

  const books: Record<StrategyKey, Book> = {
    alwaysIn: newBook(config.startCash, rungs.length),
    ladder: newBook(config.startCash, rungs.length),
    ladderRegime: newBook(config.startCash, rungs.length),
    cashOnly: newBook(config.startCash, rungs.length),
  };
  const keys = Object.keys(books) as StrategyKey[];
  const flows: CashFlow[] = [{ date: new Date(day(bars[0].date)), amount: -config.startCash }];

  let armedPeak = closes[0]; // the high the current ladder cycle is measured from
  let prevMonth = bars[0].date.slice(0, 7);
  let contributed = config.startCash;
  let indexPeak = closes[0];
  let indexMaxDd = 0;
  let prevDate = day(bars[0].date);

  // The curve is sampled monthly. A 750-point chart is noise; 36 points is a
  // shape you can read.
  let curveMonth = "";

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const close = bar.close;
    const t = day(bar.date);

    // 1. Cash earns, on calendar days, so weekends and holidays count.
    const gap = i === 0 ? 0 : Math.max(0, Math.round((t - prevDate) / DAY_MS));
    if (gap > 0) {
      const growth = Math.pow(1 + dailyYield, gap);
      for (const k of keys) books[k].cash *= growth;
    }
    prevDate = t;

    // 2. New money, on the first trading day of each month, to everyone alike.
    const month = bar.date.slice(0, 7);
    if (i > 0 && month !== prevMonth && config.monthlyContribution > 0) {
      for (const k of keys) contribute(books[k], config.monthlyContribution, close);
      contributed += config.monthlyContribution;
      flows.push({ date: new Date(t), amount: -config.monthlyContribution });
    }
    prevMonth = month;

    // 3. The index's own high, and how far below it we are.
    if (close > indexPeak) indexPeak = close;
    const idxDd = indexPeak > 0 ? ((close - indexPeak) / indexPeak) * 100 : 0;
    if (idxDd < indexMaxDd) indexMaxDd = idxDd;
    const fallPct = armedPeak > 0 ? ((armedPeak - close) / armedPeak) * 100 : 0;

    // 4. Moving averages, for the regime floor.
    const ma200 = i >= 199 ? mean(closes, i - 199, i) : 0;
    const ma50 = i >= 49 ? mean(closes, i - 49, i) : 0;
    const ma200Prev = i >= 220 ? mean(closes, i - 220, i - 21) : 0;
    const slopePct = ma200Prev > 0 ? ((ma200 - ma200Prev) / ma200Prev) * 100 : 0;
    // Before 200 days of history there is no trend to read, so the regime
    // strategy holds everything back rather than guessing a floor.
    const floorPct = ma200 > 0 ? regimeFloorFromIndex(close, ma50, ma200, slopePct) : 100;

    // 5. Always-in: every rupee goes to work the day it lands.
    if (books.alwaysIn.cash > 1) {
      buy(books.alwaysIn, books.alwaysIn.cash, close, bar.date, "money arrived", config.costPct);
    }

    // 6. The ladder, with and without the regime gate.
    for (const key of ["ladder", "ladderRegime"] as const) {
      const b = books[key];

      // Recovered to within touching distance of the high: the cycle is over,
      // rungs reset, and the pool is re-cut from whatever cash is there now.
      if (close >= armedPeak * (1 - config.rearmWithinPct / 100) && b.fired.some(Boolean)) {
        b.fired = new Array(rungs.length).fill(false);
        b.poolAtArming = b.cash;
      }

      const reserve = (b.poolAtArming * config.reservePct) / 100;
      const ladderPool = Math.max(0, b.poolAtArming - reserve);

      for (let r = 0; r < rungs.length; r++) {
        if (b.fired[r]) continue;
        if (fallPct < rungs[r].fallPct) continue;

        let slice = (ladderPool * rungs[r].pct) / 100;
        slice = Math.min(slice, Math.max(0, b.cash - reserve));

        if (key === "ladderRegime") {
          // The floor gates BUYING and never orders a sale. That is what
          // cashCheck says in the app, and a backtest must not claim a stronger
          // rule than the product actually implements.
          const value = b.units * close + b.cash;
          const floorAmount = (value * floorPct) / 100;
          slice = Math.min(slice, Math.max(0, b.cash - floorAmount));
        }

        if (slice > 1) {
          const why = (rungs[r].label || "rung " + (r + 1)) + " at " + fallPct.toFixed(1) + "% off the high";
          buy(b, slice, close, bar.date, why, config.costPct);
          b.fired[r] = true;
        }
      }
    }

    // A new high re-bases the reference every ladder measures its fall from.
    if (close >= armedPeak) armedPeak = close;

    const record = month !== curveMonth || i === bars.length - 1;
    if (record) curveMonth = month;
    for (const k of keys) markToMarket(books[k], close, bar.date, record);
  }

  const last = bars[bars.length - 1];
  const years = (day(last.date) - day(bars[0].date)) / (365.25 * DAY_MS);
  const avgIndexLevel = closes.reduce((s, c) => s + c, 0) / closes.length;

  const labels: Record<StrategyKey, string> = {
    alwaysIn: "Invest it the day it lands",
    ladder: "Ladder",
    ladderRegime: "Ladder plus regime floor",
    cashOnly: "Never invest",
  };

  const strategies: StrategyResult[] = keys.map((key) => {
    const b = books[key];
    const endEquity = b.units * last.close;
    const finalValue = endEquity + b.cash;
    const deployed = b.trades.reduce((s, x) => s + x.amount, 0);
    const wSum = b.trades.reduce((s, x) => s + x.amount * x.level, 0);
    const strategyFlows: CashFlow[] = [...flows, { date: new Date(day(last.date)), amount: finalValue }];
    return {
      key,
      label: labels[key],
      finalValue,
      contributed,
      profit: finalValue - contributed,
      returnPct: contributed > 0 ? ((finalValue - contributed) / contributed) * 100 : 0,
      xirrPct: toPct(xirr(strategyFlows)),
      maxDrawdownPct: b.maxDdPct,
      buys: b.trades.length,
      deployed,
      avgBuyLevel: deployed > 0 ? wSum / deployed : 0,
      avgTimeInvestedPct: b.investedDays > 0 ? b.investedSum / b.investedDays : 0,
      endCash: b.cash,
      endEquity,
      curve: b.curve,
    };
  });

  return {
    from: bars[0].date,
    to: last.date,
    years,
    bars: bars.length,
    indexStart: closes[0],
    indexEnd: last.close,
    indexReturnPct: ((last.close - closes[0]) / closes[0]) * 100,
    indexMaxDrawdownPct: indexMaxDd,
    avgIndexLevel,
    config,
    strategies,
    verdict: buildVerdict(strategies, avgIndexLevel),
    notes,
  };
}

// One paragraph a person can act on. It names the winner, says by how much, and
// says whether the ladder did the one thing it exists to do, which is buy lower.
function buildVerdict(strategies: StrategyResult[], avgIndexLevel: number): string {
  const by = (k: StrategyKey) => strategies.find((s) => s.key === k)!;
  const always = by("alwaysIn");
  const ladder = by("ladder");
  const regime = by("ladderRegime");
  const best = [always, ladder, regime].reduce((a, b) => ((b.xirrPct ?? -99) > (a.xirrPct ?? -99) ? b : a));

  const pct = (v: number | null) => (v == null ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%");
  const gap = (ladder.xirrPct ?? 0) - (always.xirrPct ?? 0);

  const bought =
    ladder.avgBuyLevel > 0 && avgIndexLevel > 0
      ? ((ladder.avgBuyLevel - avgIndexLevel) / avgIndexLevel) * 100
      : 0;
  const buyLine =
    ladder.buys === 0
      ? "The ladder never fired, so it sat in cash for the whole run."
      : "The ladder's average buy went in " +
        Math.abs(bought).toFixed(1) +
        "% " +
        (bought < 0 ? "below" : "above") +
        " the average index level over the period.";

  const ddLine =
    "Worst fall in portfolio value: " +
    Math.abs(always.maxDrawdownPct).toFixed(1) +
    "% investing straight away, " +
    Math.abs(ladder.maxDrawdownPct).toFixed(1) +
    "% on the ladder.";

  return (
    best.label +
    " won on money-weighted return: " +
    pct(best.xirrPct) +
    " a year against " +
    pct(always.xirrPct) +
    " for investing on arrival. The ladder came out " +
    (gap >= 0 ? "ahead by " : "behind by ") +
    Math.abs(gap).toFixed(1) +
    " points a year. " +
    buyLine +
    " " +
    ddLine
  );
}

function emptyResult(config: BacktestConfig, bars: Bar[], notes: string[]): BacktestResult {
  return {
    from: bars[0]?.date ?? "",
    to: bars[bars.length - 1]?.date ?? "",
    years: 0,
    bars: bars.length,
    indexStart: 0,
    indexEnd: 0,
    indexReturnPct: 0,
    indexMaxDrawdownPct: 0,
    avgIndexLevel: 0,
    config,
    strategies: [],
    verdict: "Not enough history to say anything.",
    notes,
  };
}

function mean(vals: number[], from: number, to: number): number {
  let s = 0;
  for (let i = from; i <= to; i++) s += vals[i];
  return s / (to - from + 1);
}

function toPct(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : v * 100;
}
