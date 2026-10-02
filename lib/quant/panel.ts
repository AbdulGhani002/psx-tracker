// One network for the whole market, walked forward through time.
//
// The first version trained a separate network per name on about a thousand
// rows each, and a thousand rows of daily returns is not enough to learn
// anything but noise. Here every name in the KSE-100 is stacked into one
// panel (the features are scale-free, so the rows are comparable) and one
// network is trained on all of them, ninety thousand rows instead of one
// thousand. That is the single honest lever for a small network: more data,
// not more layers.
//
// The walk-forward is the part that decides whether it learned anything.
// Train on everything before a date, predict the next block for every name,
// roll forward, repeat. The training window always ends `horizon` sessions
// before the first predicted day, otherwise the last training targets would
// overlap the first test features. Then the out-of-sample record is judged
// with the measures a quant desk would use rather than a headline accuracy:
//
//   skill   accuracy minus the best naive guess (always up, or always down)
//   AUC     does a higher probability actually mean a higher hit rate, on a
//           scale where 0.5 is a coin toss no matter how lopsided the base rate
//   IC      per day, the rank correlation between the model's ordering of the
//           names and how they then ranked; the standard cross-sectional test
//   spread  what the top fifth of names by model score returned against the
//           bottom fifth, relative to the index, per horizon
//
// Statistics on overlapping horizons are inflated, so the t-statistics below
// are computed on every `horizon`-th date only.

import type { EodBar } from "@/lib/timeseries/psx-eod";
import { buildFeatures, FEATURE_NAMES, EXTRA_FEATURE_NAMES, EXTRA_RANK_ONLY, TARGET_NAMES, REL_TARGET, LOW_TARGETS, HIGH_TARGETS, RANK_FEATURE_NAMES, RANK_SOURCE, type FeatureRow, type EventLike } from "./features";
import { EVENT_FEATURE_NAMES } from "./events";
import { pathCurve, depthAt, WALK_CURVE } from "./projection";
import { trainMlp, predictMlpAll, type MlpModel, type TrainOptions } from "./mlp";
import { trainGbmMulti, predictGbm, type GbmModel, type GbmOptions } from "./gbm";

// `xs`: the same row with every base and extra feature replaced by its
// percentile rank among the names on the date (less a half), context raw. The
// learners that read it see only where a name stands against the others that
// day, never the level, which is what a ranking head is asked about.
export type PanelRow = FeatureRow & { symbol: string; di: number; xs?: number[] };
export type Panel = { rows: PanelRow[]; dates: string[]; symbols: string[]; horizon: number };

export type PanelBuildOptions = {
  minRows?: number;
  context?: Map<string, number[]> | null; // per-date market/macro vector, see context.ts
  include?: (symbol: string, date: string) => boolean; // dynamic universe membership
  ranks?: boolean; // append each name's cross-sectional ranks for the date
  extras?: boolean; // the EXTRA_FEATURE_NAMES block, see features.ts
  xs?: boolean; // attach the cross-sectional view (PanelRow.xs)
  // In that view, the index's own state (DAY_STATE_FEATURES) as the day's
  // value rather than a rank across names, which for one shared number is
  // noise. Models trained with it say so in featureSet.xsDay.
  xsDay?: boolean;
  events?: Map<string, EventLike[]>; // corporate actions per name: adds the event block
};

export function buildPanel(bars: Map<string, EodBar[]>, index: EodBar[], horizon: number, o: PanelBuildOptions = {}): Panel {
  const minRows = o.minRows ?? 120;
  const dateSet = new Set<string>();
  const per: Array<[string, FeatureRow[]]> = [];
  for (const [symbol, b] of bars) {
    let rows = buildFeatures(b, index, horizon, o.context ?? null, { extras: o.extras, events: o.events ? o.events.get(symbol) ?? [] : undefined });
    if (o.include) rows = rows.filter((r) => o.include!(symbol, r.date));
    if (rows.length < minRows) continue;
    per.push([symbol, rows]);
    for (const r of rows) dateSet.add(r.date);
  }
  const dates = [...dateSet].sort();
  const di = new Map(dates.map((d, i) => [d, i]));
  const rows: PanelRow[] = [];
  for (const [symbol, rs] of per) for (const r of rs) rows.push({ ...r, symbol, di: di.get(r.date)! });
  rows.sort((a, b) => a.di - b.di || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const nOwn = FEATURE_NAMES.length + (o.extras ? EXTRA_FEATURE_NAMES.length : 0) + (o.events ? EVENT_FEATURE_NAMES.length : 0);
  if (o.xs) attachCrossSection(rows, nOwn, o.context && o.context.size > 0 ? o.context.values().next().value!.length : 0, o.xsDay ? DAY_STATE_COLS : []);
  if (o.extras) {
    const cols = EXTRA_RANK_ONLY.map((name) => FEATURE_NAMES.length + (EXTRA_FEATURE_NAMES as readonly string[]).indexOf(name));
    rankColumnsInPlace(rows, cols);
  }
  if (o.ranks) appendRanks(rows);
  assignRelTarget(rows);
  return { rows, dates, symbols: per.map((p) => p[0]).sort(), horizon };
}

// Rows of one date are contiguous (the panel is sorted by date, then name).
function eachDate(rows: PanelRow[], fn: (from: number, to: number) => void) {
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].di === rows[i].di) j++;
    fn(i, j);
    i = j;
  }
}

// Percentile rank within the date, less a half; a date with fewer than eight
// names gets neutral zeros, as in appendRanks.
function ranksOf(rows: PanelRow[], from: number, to: number, value: (r: PanelRow) => number): number[] {
  const m = to - from;
  if (m < 8) return new Array<number>(m).fill(0);
  const order = Array.from({ length: m }, (_, k) => k).sort((a, b) => value(rows[from + a]) - value(rows[from + b]));
  const out = new Array<number>(m);
  order.forEach((k, pos) => (out[k] = pos / (m - 1) - 0.5));
  return out;
}

function rankColumnsInPlace(rows: PanelRow[], cols: number[]) {
  eachDate(rows, (from, to) => {
    for (const c of cols) {
      const r = ranksOf(rows, from, to, (row) => row.x[c]);
      for (let k = from; k < to; k++) rows[k].x[c] = r[k - from];
    }
  });
}

// The index's own state: one number for the day, the same for every name
// (bar a name whose last trade is older), so its rank across names says
// nothing. With xsDay the view carries the day's value, the names' median.
export const DAY_STATE_FEATURES = ["idxRet1", "idxRet5", "idxRet20", "idxMa50_200", "idxVol20", "idxDd250"] as const;
const DAY_STATE_COLS = DAY_STATE_FEATURES.map((n) => (FEATURE_NAMES as readonly string[]).indexOf(n));

function dayMedian(rows: PanelRow[], from: number, to: number, c: number): number[] {
  const v = [];
  for (let k = from; k < to; k++) if (Number.isFinite(rows[k].x[c])) v.push(rows[k].x[c]);
  v.sort((a, b) => a - b);
  const med = v.length === 0 ? 0 : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return new Array<number>(to - from).fill(med);
}

function attachCrossSection(rows: PanelRow[], nOwn: number, ctxWidth: number, dayCols: number[] = []) {
  eachDate(rows, (from, to) => {
    const cols: number[][] = [];
    for (let c = 0; c < nOwn; c++) cols.push(dayCols.includes(c) ? dayMedian(rows, from, to, c) : ranksOf(rows, from, to, (row) => row.x[c]));
    for (let k = from; k < to; k++) {
      const xs = new Array<number>(nOwn + ctxWidth);
      for (let c = 0; c < nOwn; c++) xs[c] = cols[c][k - from];
      for (let c = 0; c < ctxWidth; c++) xs[nOwn + c] = rows[k].x[nOwn + c];
      rows[k].xs = xs;
    }
  });
}

// The soft label: each name's forward relative return as a percentile among
// the names with an outcome on the same date. Dates with fewer than five
// names keep the binary beat/miss the feature builder put there.
function assignRelTarget(rows: PanelRow[]) {
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].di === rows[i].di) j++;
    const idx: number[] = [];
    for (let k = i; k < j; k++) if (rows[k].targets && rows[k].fwdRel != null) idx.push(k);
    if (idx.length >= 5) {
      idx.sort((a, b) => rows[a].fwdRel! - rows[b].fwdRel!);
      const n = idx.length;
      for (let r = 0; r < n; r++) rows[idx[r]].targets![REL_TARGET] = r / (n - 1);
    }
    i = j;
  }
}

// The column the names are ranked on: the soft label when the learners
// carry it, the odds of beating the market otherwise (older models).
export const RANK_COL = REL_TARGET;
export const rankScore = (p: number[]) => (p.length > RANK_COL ? p[RANK_COL] : p[1]);

// Percentile rank of each RANK_SOURCE column within the date, appended to x.
// A date with fewer than eight names gets neutral zeros: a rank among three
// is not a rank.
function appendRanks(rows: PanelRow[]) {
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && rows[j].di === rows[i].di) j++;
    const n = j - i;
    if (n < 8) {
      for (let k = i; k < j; k++) rows[k].x.push(...new Array<number>(RANK_SOURCE.length).fill(0));
    } else {
      const extra: number[][] = Array.from({ length: n }, () => new Array<number>(RANK_SOURCE.length).fill(0));
      RANK_SOURCE.forEach((col, c) => {
        const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => rows[i + a].x[col] - rows[i + b].x[col]);
        for (let r = 0; r < n; r++) extra[order[r]][c] = r / (n - 1) - 0.5;
      });
      for (let k = 0; k < n; k++) rows[i + k].x.push(...extra[k]);
    }
    i = j;
  }
}

export const RANK_NAMES: readonly string[] = RANK_FEATURE_NAMES;

// A trained thing that turns a feature row into target probabilities. The
// network answers all targets at once; the boosted trees are one booster per
// target. `view` says which form of the row it reads (the raw features, or
// the cross-sectional ranks); `targets`, when set, lists the TARGET_NAMES it
// answers, in order, when that is not all of them. Models stored before either
// existed read the raw row and answer every target.
export type LearnerView = "raw" | "xs";
export type Learner =
  | { kind: "mlp"; model: MlpModel; view?: LearnerView; targets?: number[] }
  | { kind: "gbm"; models: GbmModel[]; view?: LearnerView; targets?: number[] };

// The forms of one row a learner may read.
export type FeatureViews = { x: number[]; xs?: number[] };

// Every target in TARGET_NAMES order; NaN where this learner does not answer.
export function predictLearner(l: Learner, v: number[] | FeatureViews): number[] {
  const views: FeatureViews = Array.isArray(v) ? { x: v } : v;
  const input = l.view === "xs" ? views.xs : views.x;
  if (!input) throw new Error("this model reads the cross-sectional view; build the panel with xs");
  const raw = l.kind === "mlp" ? predictMlpAll(l.model, input) : l.models.map((m) => predictGbm(m, input));
  if (!l.targets) return raw;
  const out = new Array<number>(TARGET_NAMES.length).fill(NaN);
  l.targets.forEach((t, k) => (out[t] = raw[k]));
  return out;
}

export type PanelOptions = {
  minTrain: number; // sessions of features before the first prediction
  step: number; // sessions predicted per refit
  horizon: number;
  threshold: number; // p(up) above which the per-name rule is long
  cashYieldPct: number; // annual, for sessions out of the market
  seeds: number; // learners of each kind in the ensemble, averaged
  learner: "mlp" | "gbm" | "both";
  // A second booster on the cross-sectional view, for the ranking head only,
  // averaged with the raw booster's. Needs a panel built with `xs`.
  xs?: boolean;
  train: TrainOptions;
  gbm: GbmOptions; // every head but the ranking one
  // The ranking head's own booster, when it differs (see DEFAULT_PANEL).
  gbmRel?: GbmOptions;
};

export const DEFAULT_PANEL: PanelOptions = {
  minTrain: 500,
  step: 60,
  horizon: 20,
  threshold: 0.6,
  cashYieldPct: 11,
  seeds: 3,
  learner: "gbm",
  xs: true,
  train: { hidden: [32, 16], epochs: 80, lr: 5e-3, l2: 1e-4, batch: 64, patience: 8, seed: 7 },
  // Fixed round counts, no early stopping and no held-back slice: valFrac 0
  // puts the newest 15% of the training rows back in (the booster used to hold
  // them out for a validation slice it never read with early stopping off;
  // rank IC 0.099 -> 0.105 on the 24-year walk-forward, the spread's t from 2.9
  // to 4.6).
  //
  // Two sizes, because the heads want different things. The probabilities
  // (up, beat, dip and the path heads the zones are read from) must be
  // calibrated, and forty shallow rounds keep them so: a larger booster ranked
  // the path extremes better (AUC high15 0.58 -> 0.61) but was overconfident,
  // its zones fell 1.1% behind the plain walk's on a pinball score, and its dip
  // odds lost ground (AUC 0.576 -> 0.565). The ranking head only has to order
  // the names on a date, and there the forty rounds underfit six hundred
  // thousand rows: 150 rounds at depth 5 lifted rank IC from 0.105 to 0.122 and
  // the top-minus-bottom fifth from 2.05% to 2.61% per 20 sessions, every era.
  gbm: { rounds: 40, lr: 0.05, maxDepth: 4, minLeaf: 100, lambda: 1, subsample: 0.7, colsample: 0.8, bins: 64, patience: 30, seed: 7, earlyStop: false, valFrac: 0 },
  gbmRel: { rounds: 150, lr: 0.05, maxDepth: 5, minLeaf: 300, lambda: 1, subsample: 0.7, colsample: 0.6, bins: 64, patience: 30, seed: 7, earlyStop: false, valFrac: 0 },
};

export type PanelPoint = { symbol: string; date: string; di: number; p: number[]; t: number[]; fwdRet: number; fwdRel: number; lowZ?: number; highZ?: number };

export type TargetMetrics = {
  target: string;
  n: number;
  accuracy: number;
  baseRate: number;
  naiveBest: number;
  skill: number; // points
  brier: number;
  brierNaive: number;
  auc: number;
  confidentAccuracy: number;
  confidentShare: number;
};

export type SymbolMetrics = {
  symbol: string;
  n: number;
  accuracy: number;
  naiveBest: number;
  skill: number;
  auc: number;
  aucDip: number;
  rule: { totalRetPct: number; trades: number; hitRate: number; timeInPct: number };
  buyHold: { totalRetPct: number };
  edgePct: number;
};

export type SeriesStat = { mean: number; std: number; ir: number; tStat: number; dates: number; independent: number };

// What each tenth of the model's ranking then did, per date, pooled: the
// table that turns a rank into an expected return against the market.
export type CalibrationRow = { decile: number; n: number; meanRelPct: number; meanRetPct: number; beatRate: number };

// How the zones read off the model's path curve behaved out of sample: the
// share of paths whose low reached the top of the buy zone (should be about
// a half), its bottom (a quarter), the fail level (a tenth), and the same for
// the sell zone; beside each, what the plain random-walk curve would have
// given, so the model's contribution is visible.
export type ZoneCoverage = {
  n: number; buyHigh: number; buyLow: number; fails: number; sellLow: number; sellHigh: number;
  walk: { buyHigh: number; buyLow: number; fails: number; sellLow: number; sellHigh: number };
  // The quantile (pinball) loss of the five levels, in sigmas, lower is better:
  // the proper score for a level meant to be reached a given share of the time.
  // Hit rates alone reward a curve that is right on average and useless per name.
  pinball?: { model: number; walk: number };
};

export type PanelWalkResult = {
  n: number;
  windows: number;
  from: string;
  to: string;
  horizon: number;
  symbols: number;
  targets: TargetMetrics[];
  ic: SeriesStat; // p(up) against forward return, across names, per date
  icRel: SeriesStat; // the rank score against forward relative return
  icBeat?: SeriesStat; // the odds of beating the market against the same, for comparing the two labels
  spread: SeriesStat; // top fifth minus bottom fifth by rank score, relative return per horizon, in %
  calibration?: CalibrationRow[];
  // The same table split by the market's state on the day (the equal-weight
  // index above or below its 200-day): what a rank was worth in each.
  calibrationByState?: { strong: CalibrationRow[]; weak: CalibrationRow[]; strongDates: number; weakDates: number };
  zones?: ZoneCoverage;
  perSymbol: SymbolMetrics[];
  roundsPerWindow?: number[][]; // per window, per target: rounds the boosters kept
  medianRounds?: number[]; // per target, across windows
  points?: PanelPoint[];
};

// ---------------------------------------------------------------- statistics

export function auc(pairs: Array<{ p: number; y: number }>): number {
  const n = pairs.length;
  if (n === 0) return 0.5;
  const idx = pairs.map((_, i) => i).sort((a, b) => pairs[a].p - pairs[b].p);
  const rank = new Array<number>(n);
  // Average ranks over ties.
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && pairs[idx[j + 1]].p === pairs[idx[i]].p) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k]] = r;
    i = j + 1;
  }
  let pos = 0, sum = 0;
  for (let i = 0; i < n; i++) if (pairs[i].y === 1) { pos++; sum += rank[i]; }
  const neg = n - pos;
  if (pos === 0 || neg === 0) return 0.5;
  return (sum - (pos * (pos + 1)) / 2) / (pos * neg);
}

function ranks(v: number[]): number[] {
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
  const out = new Array<number>(v.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
    const r = (i + j) / 2;
    for (let k = i; k <= j; k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3 || n !== b.length) return 0;
  const ra = ranks(a), rb = ranks(b);
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (ra[i] - ma) * (rb[i] - mb);
    saa += (ra[i] - ma) ** 2;
    sbb += (rb[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

function seriesStat(values: Array<{ di: number; v: number }>, horizon: number): SeriesStat {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, ir: 0, tStat: 0, dates: 0, independent: 0 };
  const mean = values.reduce((s, x) => s + x.v, 0) / n;
  const std = Math.sqrt(values.reduce((s, x) => s + (x.v - mean) ** 2, 0) / Math.max(1, n - 1));
  // Independent sample: every horizon-th date, so overlapping windows do not
  // count as separate evidence.
  const first = values[0].di;
  const ind = values.filter((x) => (x.di - first) % horizon === 0);
  const im = ind.reduce((s, x) => s + x.v, 0) / Math.max(1, ind.length);
  const isd = Math.sqrt(ind.reduce((s, x) => s + (x.v - im) ** 2, 0) / Math.max(1, ind.length - 1));
  const tStat = isd > 0 && ind.length > 1 ? (im / isd) * Math.sqrt(ind.length) : 0;
  return { mean, std, ir: std > 0 ? mean / std : 0, tStat, dates: n, independent: ind.length };
}

function targetMetrics(name: string, pts: Array<{ p: number; y: number }>, threshold: number): TargetMetrics {
  const n = pts.length;
  const base = pts.filter((q) => q.y === 1).length / Math.max(1, n);
  const naiveBest = Math.max(base, 1 - base);
  const accuracy = pts.filter((q) => (q.p > 0.5 ? 1 : 0) === q.y).length / Math.max(1, n);
  const brier = pts.reduce((s, q) => s + (q.p - q.y) ** 2, 0) / Math.max(1, n);
  const brierNaive = pts.reduce((s, q) => s + (base - q.y) ** 2, 0) / Math.max(1, n);
  const conf = pts.filter((q) => q.p > threshold || q.p < 1 - threshold);
  const confidentAccuracy = conf.length ? conf.filter((q) => (q.p > 0.5 ? 1 : 0) === q.y).length / conf.length : 0;
  return {
    target: name,
    n,
    accuracy,
    baseRate: base,
    naiveBest,
    skill: (accuracy - naiveBest) * 100,
    brier,
    brierNaive,
    auc: auc(pts),
    confidentAccuracy,
    confidentShare: n ? conf.length / n : 0,
  };
}

// ------------------------------------------------------------- the walk

function lowerBound(rows: PanelRow[], di: number): number {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].di < di) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function trainEnsemble(rows: PanelRow[], opts: PanelOptions, fixedRounds?: number[]): Learner[] {
  const X = rows.map((r) => r.x);
  const Y = rows.map((r) => r.targets!);
  const learners: Learner[] = [];
  const seeds = Math.max(1, opts.seeds);
  if (opts.learner !== "gbm") {
    const base = opts.train.seed ?? 7;
    for (let s = 0; s < seeds; s++) learners.push({ kind: "mlp", model: trainMlp(X, Y, { ...opts.train, seed: base + s * 101 }) });
  }
  if (opts.learner !== "mlp") {
    const base = opts.gbm.seed ?? 7;
    const relOpts = opts.gbmRel;
    const others = TARGET_NAMES.map((_, t) => t).filter((t) => !relOpts || t !== REL_TARGET);
    for (let s = 0; s < seeds; s++) {
      if (!relOpts) {
        learners.push({ kind: "gbm", models: trainGbmMulti(X, Y, { ...opts.gbm, seed: base + s * 101 }, fixedRounds) });
        continue;
      }
      const Yo = Y.map((y) => others.map((t) => y[t]));
      learners.push({ kind: "gbm", targets: others, models: trainGbmMulti(X, Yo, { ...opts.gbm, seed: base + s * 101 }, fixedRounds ? others.map((t) => fixedRounds[t]) : undefined) });
      const Yr = Y.map((y) => [y[REL_TARGET]]);
      learners.push({ kind: "gbm", targets: [REL_TARGET], models: trainGbmMulti(X, Yr, { ...relOpts, seed: base + 29 + s * 101 }, fixedRounds ? [fixedRounds[REL_TARGET]] : undefined) });
    }
    // The cross-sectional booster answers the ranking head only: averaged
    // with the raw booster it lifted rank IC to 0.129 (0.122 and 0.121 alone),
    // better than either in every era, on the 24-year walk-forward.
    if (opts.xs && rows.length > 0 && rows[0].xs) {
      const Xs = rows.map((r) => r.xs!);
      const Yr = rows.map((r) => [r.targets![REL_TARGET]]);
      const fr = fixedRounds ? [fixedRounds[REL_TARGET]] : undefined;
      for (let s = 0; s < seeds; s++) learners.push({ kind: "gbm", view: "xs", targets: [REL_TARGET], models: trainGbmMulti(Xs, Yr, { ...(opts.gbmRel ?? opts.gbm), seed: base + 53 + s * 101 }, fr) });
    }
  }
  return learners;
}

// Rounds the boosters kept, per target, averaged over the raw boosters that
// answer it.
export function roundsKept(learners: Learner[]): number[] | null {
  const g = learners.filter((l): l is Extract<Learner, { kind: "gbm" }> => l.kind === "gbm" && l.view !== "xs");
  if (g.length === 0) return null;
  return TARGET_NAMES.map((_, t) => {
    const r = g.map((l) => l.models[l.targets ? l.targets.indexOf(t) : t]?.rounds).filter((v): v is number => v != null);
    return r.length ? r.reduce((s, v) => s + v, 0) / r.length : 0;
  });
}

// Average within each kind and view, then across them, so three networks and
// one booster still count as two opinions rather than four. A learner that
// does not answer a target has no say on it.
export function predictEnsemble(learners: Learner[], v: number[] | FeatureViews): number[] {
  const k = TARGET_NAMES.length;
  const groups = new Map<string, { sum: number[]; n: number[] }>();
  for (const l of learners) {
    const p = predictLearner(l, v);
    const key = `${l.kind}:${l.view ?? "raw"}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { sum: new Array<number>(k).fill(0), n: new Array<number>(k).fill(0) }));
    for (let o = 0; o < k; o++) if (Number.isFinite(p[o])) { g.sum[o] += p[o]; g.n[o]++; }
  }
  const out = new Array<number>(k).fill(NaN);
  for (let o = 0; o < k; o++) {
    let s = 0, c = 0;
    for (const g of groups.values()) if (g.n[o] > 0) { s += g.sum[o] / g.n[o]; c++; }
    if (c > 0) out[o] = s / c;
  }
  return out;
}

export type WindowInfo = { window: number; trainRows: number; testRows: number; from: string; to: string; ms: number; rounds: number[] | null };

export function walkForwardPanel(panel: Panel, opts: PanelOptions, onWindow?: (w: WindowInfo) => void, keepPoints = false): PanelWalkResult | null {
  const usable = panel.rows.filter((r) => r.targets != null);
  const nDates = panel.dates.length;
  if (usable.length === 0 || nDates < opts.minTrain + opts.step) return null;

  const points: PanelPoint[] = [];
  const roundsPerWindow: number[][] = [];
  let windows = 0;
  for (let start = opts.minTrain; start < nDates; start += opts.step) {
    const t0 = Date.now();
    const trainEnd = lowerBound(usable, start - opts.horizon);
    const testFrom = lowerBound(usable, start);
    const testTo = lowerBound(usable, start + opts.step);
    const train = usable.slice(0, trainEnd);
    const test = usable.slice(testFrom, testTo);
    if (train.length < 200 || test.length === 0) continue;
    const learners = trainEnsemble(train, opts);
    windows++;
    const rounds = roundsKept(learners);
    if (rounds) roundsPerWindow.push(rounds);
    for (const r of test) points.push({ symbol: r.symbol, date: r.date, di: r.di, p: predictEnsemble(learners, r), t: r.targets!, fwdRet: r.fwdRet!, fwdRel: r.fwdRel!, lowZ: r.lowZ, highZ: r.highZ });
    onWindow?.({ window: windows, trainRows: train.length, testRows: test.length, from: test[0].date, to: test[test.length - 1].date, ms: Date.now() - t0, rounds });
  }
  if (points.length === 0) return null;
  const result = scorePanel(points, opts, windows, panel.symbols.length, keepPoints);
  if (roundsPerWindow.length) {
    result.roundsPerWindow = roundsPerWindow;
    const k = roundsPerWindow[0].length;
    result.medianRounds = Array.from({ length: k }, (_, o) => {
      const v = roundsPerWindow.map((w) => w[o]).sort((a, b) => a - b);
      return Math.max(10, Math.round(v[Math.floor(v.length / 2)]));
    });
  }
  return result;
}

export function scorePanel(points: PanelPoint[], opts: PanelOptions, windows: number, symbols: number, keepPoints = false): PanelWalkResult {
  // The soft label is scored against beat/miss, the only binary reading of it.
  const targets = TARGET_NAMES.map((name, j) => targetMetrics(name, points.map((q) => ({ p: q.p[j] ?? q.p[1], y: j === REL_TARGET ? q.t[1] : q.t[j] })), opts.threshold));

  // Per date: the model's ordering of the names against how they then did.
  const byDate = new Map<number, PanelPoint[]>();
  for (const q of points) {
    const g = byDate.get(q.di);
    if (g) g.push(q);
    else byDate.set(q.di, [q]);
  }
  const ic: Array<{ di: number; v: number }> = [];
  const icRel: Array<{ di: number; v: number }> = [];
  const icBeat: Array<{ di: number; v: number }> = [];
  const spread: Array<{ di: number; v: number }> = [];
  const cal = Array.from({ length: 10 }, (_, d) => ({ decile: d + 1, n: 0, rel: 0, ret: 0, beat: 0 }));
  for (const [di, g] of [...byDate.entries()].sort((a, b) => a[0] - b[0])) {
    if (g.length < 8) continue;
    ic.push({ di, v: spearman(g.map((q) => q.p[0]), g.map((q) => q.fwdRet)) });
    icRel.push({ di, v: spearman(g.map((q) => rankScore(q.p)), g.map((q) => q.fwdRel)) });
    icBeat.push({ di, v: spearman(g.map((q) => q.p[1]), g.map((q) => q.fwdRel)) });
    const sorted = [...g].sort((a, b) => rankScore(a.p) - rankScore(b.p));
    const k = Math.max(1, Math.floor(g.length / 5));
    const bottom = sorted.slice(0, k).reduce((s, q) => s + q.fwdRel, 0) / k;
    const top = sorted.slice(-k).reduce((s, q) => s + q.fwdRel, 0) / k;
    spread.push({ di, v: (top - bottom) * 100 });
    // Tenths from the bottom of the day's ranking (1) to the top (10).
    for (let r = 0; r < sorted.length; r++) {
      const c = cal[Math.min(9, Math.floor((r / sorted.length) * 10))];
      c.n++; c.rel += sorted[r].fwdRel; c.ret += sorted[r].fwdRet; c.beat += sorted[r].t[1];
    }
  }
  const calibration: CalibrationRow[] = cal.map((c) => ({ decile: c.decile, n: c.n, meanRelPct: c.n ? (c.rel / c.n) * 100 : 0, meanRetPct: c.n ? (c.ret / c.n) * 100 : 0, beatRate: c.n ? c.beat / c.n : 0 }));
  const zones = zoneCoverage(points);

  // Per name: the old single-name view, so a holding can be judged on its own.
  const bySymbol = new Map<string, PanelPoint[]>();
  for (const q of points) {
    const g = bySymbol.get(q.symbol);
    if (g) g.push(q);
    else bySymbol.set(q.symbol, [q]);
  }
  const dailyCash = Math.log(1 + opts.cashYieldPct / 100) / 252;
  const perSymbol: SymbolMetrics[] = [];
  for (const [symbol, g] of bySymbol) {
    g.sort((a, b) => a.di - b.di);
    const up = targetMetrics("up", g.map((q) => ({ p: q.p[0], y: q.t[0] })), opts.threshold);
    const dip = auc(g.map((q) => ({ p: q.p[2], y: q.t[2] })));
    // Non-overlapping trades every `horizon` sessions, so a return is never
    // counted twice: long when confident, the fund rate otherwise.
    let rule = 0, hold = 0, trades = 0, hits = 0, inDays = 0, total = 0;
    for (let i = 0; i < g.length; i += opts.horizon) {
      const q = g[i];
      hold += q.fwdRet;
      total += opts.horizon;
      if (q.p[0] > opts.threshold) {
        rule += q.fwdRet;
        trades++;
        inDays += opts.horizon;
        if (q.fwdRet > 0) hits++;
      } else rule += dailyCash * opts.horizon;
    }
    perSymbol.push({
      symbol,
      n: g.length,
      accuracy: up.accuracy,
      naiveBest: up.naiveBest,
      skill: up.skill,
      auc: up.auc,
      aucDip: dip,
      rule: { totalRetPct: (Math.exp(rule) - 1) * 100, trades, hitRate: trades ? hits / trades : 0, timeInPct: total ? (inDays / total) * 100 : 0 },
      buyHold: { totalRetPct: (Math.exp(hold) - 1) * 100 },
      edgePct: (Math.exp(rule) - Math.exp(hold)) * 100,
    });
  }
  perSymbol.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const sortedPts = [...points].sort((a, b) => a.di - b.di);
  return {
    n: points.length,
    windows,
    from: sortedPts[0].date,
    to: sortedPts[sortedPts.length - 1].date,
    horizon: opts.horizon,
    symbols,
    targets,
    ic: seriesStat(ic, opts.horizon),
    icRel: seriesStat(icRel, opts.horizon),
    icBeat: seriesStat(icBeat, opts.horizon),
    spread: seriesStat(spread, opts.horizon),
    calibration,
    zones: zones ?? undefined,
    perSymbol,
    points: keepPoints ? points : undefined,
  };
}

// What each tenth of the ranking then did, pooled over the dates given.
export function calibrationOf(points: PanelPoint[]): CalibrationRow[] {
  const byDate = new Map<number, PanelPoint[]>();
  for (const q of points) {
    const g = byDate.get(q.di);
    if (g) g.push(q);
    else byDate.set(q.di, [q]);
  }
  const cal = Array.from({ length: 10 }, (_, d) => ({ decile: d + 1, n: 0, rel: 0, ret: 0, beat: 0 }));
  for (const g of byDate.values()) {
    if (g.length < 8) continue;
    const sorted = [...g].sort((a, b) => rankScore(a.p) - rankScore(b.p));
    for (let r = 0; r < sorted.length; r++) {
      const c = cal[Math.min(9, Math.floor((r / sorted.length) * 10))];
      c.n++; c.rel += sorted[r].fwdRel; c.ret += sorted[r].fwdRet; c.beat += sorted[r].t[1];
    }
  }
  return cal.map((c) => ({ decile: c.decile, n: c.n, meanRelPct: c.n ? (c.rel / c.n) * 100 : 0, meanRetPct: c.n ? (c.ret / c.n) * 100 : 0, beatRate: c.n ? c.beat / c.n : 0 }));
}

// The table split by the market's state on each date.
export function calibrationByState(points: PanelPoint[], gate: Map<string, boolean>): { strong: CalibrationRow[]; weak: CalibrationRow[]; strongDates: number; weakDates: number } {
  const strong = points.filter((q) => gate.get(q.date) === true);
  const weak = points.filter((q) => gate.get(q.date) === false);
  const dates = (pts: PanelPoint[]) => new Set(pts.map((q) => q.di)).size;
  return { strong: calibrationOf(strong), weak: calibrationOf(weak), strongDates: dates(strong), weakDates: dates(weak) };
}

// Where the zones come from: the model's own path curve only when, out of
// sample, it placed the levels better than the plain walk by a clear margin
// (half a percent on the pinball score); otherwise the walk over the name's
// own volatility, which is what the levels were worth anyway.
export const ZONE_MARGIN = 0.005;
export function zoneSourceOf(z: ZoneCoverage | null | undefined): "model" | "walk" {
  if (!z?.pinball || !(z.pinball.walk > 0)) return "walk";
  return (z.pinball.walk - z.pinball.model) / z.pinball.walk >= ZONE_MARGIN ? "model" : "walk";
}

// The zones' out-of-sample coverage, model curve against the walk's curve.
export function zoneCoverage(points: PanelPoint[]): ZoneCoverage | null {
  const pts = points.filter((q) => q.lowZ != null && q.highZ != null && q.p.length > HIGH_TARGETS[2]);
  if (pts.length === 0) return null;
  const walkLo = pathCurve(WALK_CURVE), walkHi = pathCurve(WALK_CURVE);
  const dLo = { h: depthAt(walkLo, 0.5), l: depthAt(walkLo, 0.25), f: depthAt(walkLo, 0.1) };
  const dHi = { l: depthAt(walkHi, 0.5), h: depthAt(walkHi, 0.25) };
  let bh = 0, bl = 0, f = 0, sl = 0, sh = 0, wbh = 0, wbl = 0, wf = 0, wsl = 0, wsh = 0;
  let pm = 0, pw = 0;
  const pin = (u: number, tau: number) => u * (tau - (u < 0 ? 1 : 0));
  for (const q of pts) {
    const lo = pathCurve(LOW_TARGETS.map((i) => q.p[i])), hi = pathCurve(HIGH_TARGETS.map((i) => q.p[i]));
    const lz = -q.lowZ!, hz = q.highZ!; // depths reached, in sigmas
    pm += pin(lz - depthAt(lo, 0.5), 0.5) + pin(lz - depthAt(lo, 0.25), 0.75) + pin(lz - depthAt(lo, 0.1), 0.9) + pin(hz - depthAt(hi, 0.5), 0.5) + pin(hz - depthAt(hi, 0.25), 0.75);
    pw += pin(lz - dLo.h, 0.5) + pin(lz - dLo.l, 0.75) + pin(lz - dLo.f, 0.9) + pin(hz - dHi.l, 0.5) + pin(hz - dHi.h, 0.75);
    if (lz >= depthAt(lo, 0.5)) bh++;
    if (lz >= depthAt(lo, 0.25)) bl++;
    if (lz >= depthAt(lo, 0.1)) f++;
    if (hz >= depthAt(hi, 0.5)) sl++;
    if (hz >= depthAt(hi, 0.25)) sh++;
    if (lz >= dLo.h) wbh++;
    if (lz >= dLo.l) wbl++;
    if (lz >= dLo.f) wf++;
    if (hz >= dHi.l) wsl++;
    if (hz >= dHi.h) wsh++;
  }
  const n = pts.length;
  return { n, buyHigh: bh / n, buyLow: bl / n, fails: f / n, sellLow: sl / n, sellHigh: sh / n, walk: { buyHigh: wbh / n, buyLow: wbl / n, fails: wf / n, sellLow: wsl / n, sellHigh: wsh / n }, pinball: { model: pm / n, walk: pw / n } };
}

// Train on every row with a known outcome, for the forecasts that go out.
// With `fixedRounds` (the median the walk-forward windows kept) the boosters
// take that many rounds instead of judging by the most recent slice alone.
export function trainFinal(panel: Panel, opts: PanelOptions, fixedRounds?: number[]): { learners: Learner[]; rows: number; trainedTo: string } {
  const usable = panel.rows.filter((r) => r.targets != null);
  const learners = trainEnsemble(usable, opts, fixedRounds);
  return { learners, rows: usable.length, trainedTo: usable[usable.length - 1]?.date ?? "" };
}

// The words for a number. AUC is the honest scale: 0.5 is a coin toss no
// matter how lopsided the base rate is, so "84% accurate" on a market that
// rose 84% of the time cannot hide behind the percentage.
export function describeAuc(a: number): string {
  if (a >= 0.65) return "clear skill";
  if (a >= 0.58) return "real but modest skill";
  if (a >= 0.53) return "slight skill";
  if (a > 0.47) return "coin toss";
  return "worse than a coin toss";
}
