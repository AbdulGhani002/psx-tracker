// Does the network know anything? Walk it forward through history and find out.
//
// Train on the first N sessions, predict the next block, roll forward, repeat.
// Every prediction is made on data the model had never seen, so what comes out
// is an out-of-sample record and not a curve fit dressed as one. Then the
// record is judged three ways:
//
//   1. Directional accuracy — against the honest baseline, which is NOT 50%.
//      PSX drifts upward, so "always say up" is right more than half the time,
//      and a model has to beat THAT to have learned anything.
//   2. Brier score — are the probabilities calibrated, or just noisy?
//   3. A trading rule — long when the model is confident, cash (earning the
//      fund rate) when it is not — against buy-and-hold over the same days.
//
// The number shown to the user is SKILL: accuracy minus the best naive
// baseline. Zero means the network is a coin toss. That number rides along
// with every forecast it sends, so nobody has to remember how much to trust it.

import { trainMlp, predictMlp, type TrainOptions } from "./mlp";
import type { FeatureRow } from "./features";

export type WalkOptions = {
  minTrain: number; // sessions before the first prediction
  step: number; // sessions predicted per refit
  horizon: number; // forward days the target measures
  threshold: number; // p above which the rule goes long
  cashYieldPct: number; // annual, for days out of the market
  train?: TrainOptions;
};

export const DEFAULT_WALK: WalkOptions = {
  minTrain: 500,
  step: 60,
  horizon: 5,
  threshold: 0.55,
  cashYieldPct: 11,
  train: { hidden: [16, 8], epochs: 150, lr: 5e-3, l2: 1e-3, batch: 32, patience: 12, seed: 7 },
};

export type OosPoint = { date: string; p: number; y: number; fwdRet: number };

export type WalkResult = {
  n: number;
  windows: number;
  accuracy: number; // of p>0.5 vs y
  baselineUp: number; // share of days that went up
  naiveBest: number; // max(baselineUp, 1 - baselineUp)
  skill: number; // accuracy - naiveBest, in points
  brier: number;
  brierNaive: number; // predicting the base rate every time
  confidentAccuracy: number; // accuracy when p > threshold or p < 1 - threshold
  confidentShare: number; // how often it was that confident
  rule: { totalRetPct: number; trades: number; hitRate: number; timeInPct: number };
  buyHold: { totalRetPct: number };
  edgePct: number; // rule minus buy-and-hold, total over the OOS period
  from: string;
  to: string;
  points: OosPoint[];
};

export function walkForward(rows: FeatureRow[], opts: WalkOptions = DEFAULT_WALK): WalkResult | null {
  const usable = rows.filter((r) => r.y != null && r.fwdRet != null);
  if (usable.length < opts.minTrain + opts.step) return null;

  const points: OosPoint[] = [];
  let windows = 0;
  for (let start = opts.minTrain; start < usable.length; start += opts.step) {
    // The training window must end `horizon` days before the first prediction,
    // otherwise the last training targets overlap the first test features.
    const trainEnd = start - opts.horizon;
    const train = usable.slice(0, trainEnd);
    const test = usable.slice(start, start + opts.step);
    if (train.length < 100 || test.length === 0) continue;
    const model = trainMlp(train.map((r) => r.x), train.map((r) => r.y!), opts.train);
    windows++;
    for (const r of test) points.push({ date: r.date, p: predictMlp(model, r.x), y: r.y!, fwdRet: r.fwdRet! });
  }
  if (points.length === 0) return null;

  const n = points.length;
  const ups = points.filter((q) => q.y === 1).length;
  const baselineUp = ups / n;
  const naiveBest = Math.max(baselineUp, 1 - baselineUp);
  const correct = points.filter((q) => (q.p > 0.5 ? 1 : 0) === q.y).length;
  const accuracy = correct / n;
  const brier = points.reduce((s, q) => s + (q.p - q.y) ** 2, 0) / n;
  const brierNaive = points.reduce((s, q) => s + (baselineUp - q.y) ** 2, 0) / n;

  const confident = points.filter((q) => q.p > opts.threshold || q.p < 1 - opts.threshold);
  const confidentAccuracy = confident.length > 0 ? confident.filter((q) => (q.p > 0.5 ? 1 : 0) === q.y).length / confident.length : 0;

  // Non-overlapping trades every `horizon` sessions, so a five-day return is
  // never counted twice.
  const dailyCash = Math.log(1 + opts.cashYieldPct / 100) / 252;
  let rule = 0, hold = 0, trades = 0, hits = 0, inDays = 0, total = 0;
  for (let i = 0; i < n; i += opts.horizon) {
    const q = points[i];
    hold += q.fwdRet;
    total += opts.horizon;
    if (q.p > opts.threshold) {
      rule += q.fwdRet;
      trades++;
      inDays += opts.horizon;
      if (q.fwdRet > 0) hits++;
    } else {
      rule += dailyCash * opts.horizon;
    }
  }

  return {
    n,
    windows,
    accuracy,
    baselineUp,
    naiveBest,
    skill: (accuracy - naiveBest) * 100,
    brier,
    brierNaive,
    confidentAccuracy,
    confidentShare: confident.length / n,
    rule: {
      totalRetPct: (Math.exp(rule) - 1) * 100,
      trades,
      hitRate: trades > 0 ? hits / trades : 0,
      timeInPct: total > 0 ? (inDays / total) * 100 : 0,
    },
    buyHold: { totalRetPct: (Math.exp(hold) - 1) * 100 },
    edgePct: (Math.exp(rule) - Math.exp(hold)) * 100,
    from: points[0].date,
    to: points[n - 1].date,
    points,
  };
}

// Train on everything and say what the model thinks about the latest session.
// Returned beside the walk-forward skill so the reader knows what the number
// is worth.
export function latestForecast(rows: FeatureRow[], opts: WalkOptions = DEFAULT_WALK): { date: string; p: number } | null {
  const train = rows.filter((r) => r.y != null);
  const last = rows[rows.length - 1];
  if (!last || train.length < opts.minTrain) return null;
  const model = trainMlp(train.map((r) => r.x), train.map((r) => r.y!), opts.train);
  return { date: last.date, p: predictMlp(model, last.x) };
}

// The words that go under a probability. Blunt on purpose: the reader should
// never mistake 53% for a view.
export function describeForecast(p: number, skill: number): string {
  const lean = p >= 0.6 ? "leans up" : p <= 0.4 ? "leans down" : "no lean";
  const worth = skill >= 5 ? "some skill" : skill >= 2 ? "slight skill" : skill > -2 ? "coin toss" : "worse than guessing";
  return `${(p * 100).toFixed(0)}% up next 5 sessions, ${lean}; model skill ${skill >= 0 ? "+" : ""}${skill.toFixed(1)} pts (${worth})`;
}
