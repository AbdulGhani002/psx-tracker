// Model research on the 24-year archive: one panel, several variants, the same
// walk-forward windows for every variant, and the numbers that decide whether a
// change is kept.
//
//   NODE_OPTIONS=--max-old-space-size=5000 npx tsx scripts/quant-lab.ts --archive C:/CC/Data/psx-history
//        --variants base,full,extra,xs,xsBig,mlp [--targets rel] [--step 250] [--minTrain 750] [--top 120] [--thin 1]
//
// The ranking head is judged on rank IC and the top-minus-bottom-fifth spread,
// overall and by era, and on the gated rule the report follows; the path heads
// (where the zones come from) on AUC and a pinball score of the zone levels
// against the plain-walk curve. Every variant sees exactly the same training
// and test rows, so the differences are the variant's and not the sample's.
// Nothing here is shipped: what wins moves into features.ts and panel.ts.

import { buildArchivePanel } from "../lib/quant/archive";
import { spearman, auc, type PanelPoint } from "../lib/quant/panel";
import { trainGbmMulti, predictGbm, type GbmOptions, type GbmModel } from "../lib/quant/gbm";
import { trainMlp, predictMlpAll, type TrainOptions, type MlpModel } from "../lib/quant/mlp";
import { FEATURE_NAMES, TARGET_NAMES, LOW_TARGETS, HIGH_TARGETS, REL_TARGET, SIGMA_FLOOR } from "../lib/quant/features";
import { pathCurve, depthAt, WALK_CURVE } from "../lib/quant/projection";
import { strategyBacktest } from "../lib/quant/strategy";
import type { EodBar } from "../lib/timeseries/psx-eod";
import { readFileSync } from "node:fs";
import { extractActions, eventFeaturesAt, EVENT_FEATURE_NAMES, type CorporateAction } from "../lib/quant/events";
import type { RawRow } from "../lib/quant/archive";
import { has, argOf, num } from "./quant-cli";

const ARCHIVE = argOf("archive") || "C:/CC/Data/psx-history";
const HORIZON = num("horizon", 20);
const STEP = num("step", 250);
const MIN_TRAIN = num("minTrain", 750);
const TOP = num("top", 120);
const VARIANTS = (argOf("variants") ?? "base,full").split(",").map((s) => s.trim()).filter(Boolean);
const TARGETS = (argOf("targets") ?? "rel").split(",").map((s) => s.trim()).filter(Boolean);
const THIN = num("thin", 1); // train on every k-th date only (the labels overlap anyway)

// ------------------------------------------------------------ extra features

export const EXTRA_NAMES = [
  "skew60", "kurt60", "minRet20z", "upVol20", "ac60", "idDisc", "seas1", "seas3",
  "lnTV60", "amihud60", "vol5_60", "dd60", "trendQ60", "range20z", "ret250",
] as const;
// Levels that drift with the rupee and the market's size over 24 years: only
// their cross-sectional rank means anything.
const RANK_ONLY = new Set(["lnTV60", "amihud60"]);

const clip = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v);
const ln = Math.log;

function extraFeatures(bars: EodBar[], index: EodBar[]): Map<string, number[]> {
  // The last element of each row is the 60-session daily sigma, for the
  // risk-adjusted label; it is split off before the row is used as features.
  const byDate = new Map(index.map((b) => [b.date, b.close]));
  const rows = bars.filter((b) => byDate.has(b.date) && b.close > 0);
  const c = rows.map((b) => b.close), v = rows.map((b) => b.volume), ix = rows.map((b) => byDate.get(b.date)!);
  const n = rows.length;
  const r = new Float64Array(n);
  for (let i = 1; i < n; i++) r[i] = clip(ln(c[i] / c[i - 1]), 0.2);
  const out = new Map<string, number[]>();
  const sd = (from: number, to: number) => {
    let m = 0;
    for (let k = from; k <= to; k++) m += r[k];
    m /= to - from + 1;
    let s = 0;
    for (let k = from; k <= to; k++) s += (r[k] - m) ** 2;
    return { m, s: Math.sqrt(s / (to - from + 1)) };
  };
  const relOver = (a: number, b: number) => ln(c[b] / c[a]) - ln(ix[b] / ix[a]);
  for (let i = 250; i < n; i++) {
    const w60 = sd(i - 59, i);
    const sig = Math.max(SIGMA_FLOOR, w60.s);
    let m3 = 0, m4 = 0;
    for (let k = i - 59; k <= i; k++) { const d = r[k] - w60.m; m3 += d ** 3; m4 += d ** 4; }
    m3 /= 60; m4 /= 60;
    const s2 = w60.s * w60.s;
    const skew = s2 > 1e-12 ? m3 / s2 ** 1.5 : 0;
    const kurt = s2 > 1e-12 ? m4 / (s2 * s2) - 3 : 0;
    let minR = 0, upV = 0, allV = 0;
    for (let k = i - 19; k <= i; k++) {
      if (r[k] < minR) minR = r[k];
      if (v[k] > 0) { allV += v[k]; if (r[k] > 0) upV += v[k]; }
    }
    let sxy = 0, sxx = 0;
    for (let k = i - 58; k <= i; k++) { sxy += (r[k] - w60.m) * (r[k - 1] - w60.m); sxx += (r[k] - w60.m) ** 2; }
    const ac = sxx > 1e-12 ? sxy / sxx : 0;
    let pos = 0, neg = 0;
    for (let k = i - 249; k <= i - 20; k++) { if (r[k] > 0) pos++; else if (r[k] < 0) neg++; }
    const mom = ln(c[i - 20] / c[i - 250]);
    const idDisc = Math.sign(mom) * ((neg - pos) / 230);
    const seas1 = i >= 252 ? relOver(i - 252, i - 232) : 0;
    const lags = [252, 504, 756].filter((L) => i - L >= 0);
    const seas3 = lags.length ? lags.reduce((s, L) => s + relOver(i - L, i - L + 20), 0) / lags.length : 0;
    let tv = 0, ami = 0, amiN = 0;
    for (let k = i - 59; k <= i; k++) {
      const val = c[k] * v[k];
      tv += val;
      if (val > 0) { ami += Math.abs(r[k]) / val; amiN++; }
    }
    const vol5 = sd(i - 4, i).s;
    let hi60 = 0;
    for (let k = i - 59; k <= i; k++) if (c[k] > hi60) hi60 = c[k];
    // Trend quality: R^2 of log price on time over 60 sessions, signed by the slope.
    let st = 0, sy = 0, stt = 0, sty = 0, syy = 0;
    for (let k = 0; k < 60; k++) { const y = ln(c[i - 59 + k]); st += k; sy += y; stt += k * k; sty += k * y; syy += y * y; }
    const cov = sty / 60 - (st / 60) * (sy / 60), vt = stt / 60 - (st / 60) ** 2, vy = syy / 60 - (sy / 60) ** 2;
    const r2 = vt > 0 && vy > 1e-12 ? (cov * cov) / (vt * vy) : 0;
    let hi20 = 0, lo20 = Infinity;
    for (let k = i - 19; k <= i; k++) { if (c[k] > hi20) hi20 = c[k]; if (c[k] < lo20) lo20 = c[k]; }
    out.set(rows[i].date, [
      clip(skew, 3) / 3,
      clip(kurt, 20) / 10,
      clip(minR / sig, 8) / 4,
      allV > 0 ? upV / allV - 0.5 : 0,
      clip(ac, 1),
      idDisc,
      clip(seas1, 0.4) * 4,
      clip(seas3, 0.4) * 4,
      ln(1 + tv / 60),
      amiN ? ln(1e-15 + ami / amiN) : 0,
      clip(w60.s > 0 && vol5 > 0 ? ln(vol5 / w60.s) : 0, 2) / 2,
      clip(ln(c[i] / hi60), 0.6) * 2,
      Math.sign(cov) * r2,
      clip(ln(hi20 / lo20) / (sig * Math.sqrt(20)), 6) / 3 - 1,
      clip(ln(c[i] / c[i - 250]), 1.5),
      sig,
    ]);
  }
  return out;
}

// ------------------------------------------------------------------ variants

type Variant = {
  name: string;
  feats: "base" | "full" | "extra" | "xs";
  learner: "gbm" | "mlp";
  gbm?: GbmOptions;
  mlp?: TrainOptions;
  thin?: number;
  label?: "rel" | "relRisk"; // relRisk: percentile of fwdRel / sigma on the date
  events?: boolean; // add the corporate-action block (lib/quant/events.ts)
};

const GBM_BASE: GbmOptions = { rounds: 40, lr: 0.05, maxDepth: 4, minLeaf: 100, lambda: 1, subsample: 0.7, colsample: 0.8, bins: 64, patience: 30, seed: 7, earlyStop: false };
// "full": the same learner, but every training row is used (the shipped
// booster holds back the newest 15% for a validation slice it never reads).
const GBM_FULL: GbmOptions = { ...GBM_BASE, valFrac: 0 };
const GBM_BIG: GbmOptions = { ...GBM_FULL, rounds: 150, maxDepth: 5, minLeaf: 300, colsample: 0.6 };
const MLP_OPTS: TrainOptions = { hidden: [32, 16], epochs: 25, lr: 3e-3, l2: 1e-4, batch: 256, patience: 4, seed: 7, valFrac: 0.1 };

const ALL: Record<string, Variant> = {
  base: { name: "base", feats: "base", learner: "gbm", gbm: GBM_BASE },
  full: { name: "full", feats: "base", learner: "gbm", gbm: GBM_FULL },
  extra: { name: "extra", feats: "extra", learner: "gbm", gbm: GBM_FULL },
  xs: { name: "xs", feats: "xs", learner: "gbm", gbm: GBM_FULL },
  xsBig: { name: "xsBig", feats: "xs", learner: "gbm", gbm: GBM_BIG },
  extraBig: { name: "extraBig", feats: "extra", learner: "gbm", gbm: GBM_BIG },
  mlp: { name: "mlp", feats: "xs", learner: "mlp", mlp: MLP_OPTS, thin: 3 },
  mlpExtra: { name: "mlpExtra", feats: "extra", learner: "mlp", mlp: MLP_OPTS, thin: 3 },
  extraRisk: { name: "extraRisk", feats: "extra", learner: "gbm", gbm: GBM_FULL, label: "relRisk" },
  eventBig: { name: "eventBig", feats: "extra", learner: "gbm", gbm: GBM_BIG, events: true },
  xsEventBig: { name: "xsEventBig", feats: "xs", learner: "gbm", gbm: GBM_BIG, events: true },
  extraSmall: { name: "extraSmall", feats: "extra", learner: "gbm", gbm: GBM_FULL },
  eventSmall: { name: "eventSmall", feats: "extra", learner: "gbm", gbm: GBM_FULL, events: true },
  xsRisk: { name: "xsRisk", feats: "xs", learner: "gbm", gbm: GBM_FULL, label: "relRisk" },
  mlpRisk: { name: "mlpRisk", feats: "xs", learner: "mlp", mlp: MLP_OPTS, thin: 3, label: "relRisk" },
};

// --------------------------------------------------------------------- main

function lowerBound(di: Int32Array, v: number): number {
  let lo = 0, hi = di.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (di[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

// Percentile rank of every listed column within each date, less a half.
function xsRanks(rowsDi: Int32Array, cols: Float64Array[], nCols: number): Float32Array[] {
  const n = rowsDi.length;
  const out = Array.from({ length: n }, () => new Float32Array(nCols));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && rowsDi[j] === rowsDi[i]) j++;
    const m = j - i;
    if (m >= 8) {
      const order = new Array<number>(m);
      for (let c = 0; c < nCols; c++) {
        for (let k = 0; k < m; k++) order[k] = k;
        order.sort((a, b) => cols[i + a][c] - cols[i + b][c]);
        for (let r = 0; r < m; r++) out[i + order[r]][c] = r / (m - 1) - 0.5;
      }
    }
    i = j;
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const targetIdx = TARGETS.map((t) => {
    const k = (TARGET_NAMES as readonly string[]).indexOf(t);
    if (k < 0) throw new Error(`unknown target ${t}`);
    return k;
  });
  console.log(`Building the archive panel from ${ARCHIVE} (top ${TOP}, horizon ${HORIZON})...`);
  const arch = buildArchivePanel(ARCHIVE, HORIZON, TOP, false, null);
  const usable = arch.panel.rows.filter((r) => r.targets != null);
  const nOwn = FEATURE_NAMES.length;
  const nCtx = arch.contextNames.length;
  console.log(`Panel: ${usable.length.toLocaleString()} usable rows, ${arch.panel.symbols.length} names, ${arch.panel.dates.length} dates, ${nOwn} own + ${nCtx} context features. ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Extra features, aligned by symbol and date.
  const needExtra = VARIANTS.some((v) => ALL[v]?.feats !== "base");
  const extras: Float64Array[] = [];
  const sig60 = new Float64Array(usable.length);
  if (needExtra) {
    const cache = new Map<string, Map<string, number[]>>();
    for (const r of usable) {
      let m = cache.get(r.symbol);
      if (!m) cache.set(r.symbol, (m = extraFeatures(arch.bars.get(r.symbol)!, arch.index)));
      const e = m.get(r.date);
      sig60[extras.length] = e ? e[EXTRA_NAMES.length] : SIGMA_FLOOR;
      extras.push(Float64Array.from((e ?? new Array(EXTRA_NAMES.length + 1).fill(0)).slice(0, EXTRA_NAMES.length)));
    }
    console.log(`Extra features: ${EXTRA_NAMES.length} per row. ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const di = Int32Array.from(usable.map((r) => r.di));
  // The corporate-action block, from the raw sheets' LDCP, per row.
  const nEv = EVENT_FEATURE_NAMES.length;
  const evRows: Float64Array[] = [];
  let evRank: Float32Array[] | null = null;
  if (VARIANTS.some((v) => ALL[v]?.events)) {
    const actionsBy = new Map<string, CorporateAction[]>();
    for (const sym of arch.panel.symbols) {
      try { actionsBy.set(sym, extractActions(JSON.parse(readFileSync(`${ARCHIVE}/symbols/${sym}.json`, "utf8")) as RawRow[])); } catch { actionsBy.set(sym, []); }
    }
    for (const r of usable) evRows.push(Float64Array.from(eventFeaturesAt(actionsBy.get(r.symbol) ?? [], r.date)));
    evRank = xsRanks(di, evRows, nEv);
    const nAct = [...actionsBy.values()].reduce((s2, a) => s2 + a.length, 0);
    console.log(`Event block: ${nEv} features from ${nAct.toLocaleString()} actions on ${actionsBy.size} names. ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // Percentile of the forward relative return per unit of the name's own
  // volatility, within each date: the label for the relRisk variants.
  const relRisk = new Float64Array(usable.length);
  if (needExtra) {
    let i = 0;
    while (i < usable.length) {
      let j = i;
      while (j < usable.length && di[j] === di[i]) j++;
      const idx = Array.from({ length: j - i }, (_, k) => i + k);
      const score = (k: number) => usable[k].fwdRel! / Math.max(SIGMA_FLOOR, sig60[k]);
      idx.sort((a, b) => score(a) - score(b));
      idx.forEach((k, pos) => (relRisk[k] = idx.length > 1 ? pos / (idx.length - 1) : 0.5));
      i = j;
    }
  }
  const nDates = arch.panel.dates.length;

  // Cross-sectional ranks of the own features plus the extras, once.
  let xs: Float32Array[] | null = null;
  if (VARIANTS.some((v) => ALL[v]?.feats === "xs" || ALL[v]?.feats === "extra")) {
    const cols = usable.map((r, k) => {
      const a = new Float64Array(nOwn + EXTRA_NAMES.length);
      for (let j = 0; j < nOwn; j++) a[j] = r.x[j];
      for (let j = 0; j < EXTRA_NAMES.length; j++) a[nOwn + j] = extras[k][j];
      return a;
    });
    xs = xsRanks(di, cols, nOwn + EXTRA_NAMES.length);
    console.log(`Cross-sectional ranks: ${nOwn + EXTRA_NAMES.length} columns. ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  const rankOnlyIdx = EXTRA_NAMES.map((n2, j) => (RANK_ONLY.has(n2) ? j : -1)).filter((j) => j >= 0);
  const matrixFor = (v: Variant): Float64Array[] =>
    usable.map((r, k) => {
      if (v.feats === "base") return Float64Array.from(r.x);
      const ne = v.events ? nEv : 0;
      if (v.feats === "extra") {
        // Base features, the extras raw (the drifting levels as ranks), events, context.
        const a = new Float64Array(nOwn + EXTRA_NAMES.length + ne + nCtx);
        for (let j = 0; j < nOwn; j++) a[j] = r.x[j];
        for (let j = 0; j < EXTRA_NAMES.length; j++) a[nOwn + j] = rankOnlyIdx.includes(j) ? xs![k][nOwn + j] : extras[k][j];
        for (let j = 0; j < ne; j++) a[nOwn + EXTRA_NAMES.length + j] = evRows[k][j];
        for (let j = 0; j < nCtx; j++) a[nOwn + EXTRA_NAMES.length + ne + j] = r.x[nOwn + j];
        return a;
      }
      // xs: every own, extra and event feature as its rank on the date, context raw.
      const a = new Float64Array(nOwn + EXTRA_NAMES.length + ne + nCtx);
      for (let j = 0; j < nOwn + EXTRA_NAMES.length; j++) a[j] = xs![k][j];
      for (let j = 0; j < ne; j++) a[nOwn + EXTRA_NAMES.length + j] = evRank![k][j];
      for (let j = 0; j < nCtx; j++) a[nOwn + EXTRA_NAMES.length + ne + j] = r.x[nOwn + j];
      return a;
    });

  // The windows, the same for every variant.
  const windows: Array<{ trainEnd: number; testFrom: number; testTo: number }> = [];
  for (let start = MIN_TRAIN; start < nDates; start += STEP) {
    const trainEnd = lowerBound(di, start - HORIZON);
    const testFrom = lowerBound(di, start), testTo = lowerBound(di, start + STEP);
    if (trainEnd >= 200 && testTo > testFrom) windows.push({ trainEnd, testFrom, testTo });
  }
  const testRows: number[] = [];
  for (const w of windows) for (let k = w.testFrom; k < w.testTo; k++) testRows.push(k);
  console.log(`${windows.length} windows, ${testRows.length.toLocaleString()} test rows, targets ${TARGETS.join("/")}.\n`);

  const preds = new Map<string, Float32Array>(); // variant -> testRows x targets
  for (const vn of VARIANTS) {
    const v = ALL[vn];
    if (!v) { console.log(`unknown variant ${vn}, skipped`); continue; }
    const tv = Date.now();
    const X = matrixFor(v);
    const out = new Float32Array(testRows.length * targetIdx.length);
    let o = 0;
    for (const [wi, w] of windows.entries()) {
      const tw = Date.now();
      const thin = v.thin ?? THIN;
      const trIdx: number[] = [];
      for (let k = 0; k < w.trainEnd; k++) if (thin <= 1 || di[k] % thin === 0) trIdx.push(k);
      const Xtr = trIdx.map((k) => X[k] as unknown as number[]);
      const Ytr = trIdx.map((k) => targetIdx.map((t) => (v.label === "relRisk" && t === REL_TARGET ? relRisk[k] : usable[k].targets![t])));
      let predict: (x: Float64Array) => number[];
      if (v.learner === "gbm") {
        const models: GbmModel[] = trainGbmMulti(Xtr, Ytr, v.gbm);
        predict = (x) => models.map((m) => predictGbm(m, x as unknown as number[]));
      } else {
        const model: MlpModel = trainMlp(Xtr, Ytr, v.mlp);
        predict = (x) => predictMlpAll(model, Array.from(x));
      }
      for (let k = w.testFrom; k < w.testTo; k++) {
        const p = predict(X[k]);
        for (let t = 0; t < targetIdx.length; t++) out[o * targetIdx.length + t] = p[t];
        o++;
      }
      process.stdout.write(`  ${v.name} window ${wi + 1}/${windows.length} (${usable[w.testFrom].date.slice(0, 4)}) ${((Date.now() - tw) / 1000).toFixed(0)}s\r`);
    }
    preds.set(v.name, out);
    console.log(`  ${v.name}: ${windows.length} windows in ${((Date.now() - tv) / 1000).toFixed(0)}s                         `);
    report(v.name, out);
  }

  // Blends of the ranking head: the mean of each variant's within-date rank.
  if (has("blend") && TARGETS.includes("rel")) {
    const names = [...preds.keys()];
    for (let a = 0; a < names.length; a++)
      for (let b = a + 1; b < names.length; b++) {
        const blended = blendRanks(preds.get(names[a])!, preds.get(names[b])!);
        report(`${names[a]}+${names[b]}`, blended);
      }
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s total`);

  // ------------------------------------------------------------ scoring

  function blendRanks(a: Float32Array, b: Float32Array): Float32Array {
    const rel = TARGETS.indexOf("rel"), K = TARGETS.length;
    const out = new Float32Array(testRows.length * K);
    out.set(a);
    let i = 0;
    while (i < testRows.length) {
      let j = i;
      while (j < testRows.length && di[testRows[j]] === di[testRows[i]]) j++;
      const m = j - i;
      const ra = rankWithin(a, i, j, rel, K), rb = rankWithin(b, i, j, rel, K);
      for (let k = 0; k < m; k++) out[(i + k) * K + rel] = (ra[k] + rb[k]) / 2 / Math.max(1, m - 1);
      i = j;
    }
    return out;
  }
  function rankWithin(p: Float32Array, i: number, j: number, col: number, K: number): number[] {
    const m = j - i;
    const order = Array.from({ length: m }, (_, k) => k).sort((x, y) => p[(i + x) * K + col] - p[(i + y) * K + col]);
    const r = new Array<number>(m);
    order.forEach((k, pos) => (r[k] = pos));
    return r;
  }

  function report(name: string, p: Float32Array) {
    const K = TARGETS.length;
    const lines: string[] = [];
    const rel = TARGETS.indexOf("rel");
    if (rel >= 0) {
      const ic: Array<{ di: number; v: number; year: number }> = [], spread: Array<{ di: number; v: number }> = [];
      const dec = Array.from({ length: 10 }, () => ({ n: 0, s: 0 }));
      const points: PanelPoint[] = [];
      let i = 0;
      while (i < testRows.length) {
        let j = i;
        while (j < testRows.length && di[testRows[j]] === di[testRows[i]]) j++;
        const g = Array.from({ length: j - i }, (_, k) => i + k);
        for (const k of g) {
          const row = usable[testRows[k]];
          points.push({ symbol: row.symbol, date: row.date, di: row.di, p: [0, 0, 0, p[k * K + rel]], t: row.targets!, fwdRet: row.fwdRet!, fwdRel: row.fwdRel! });
        }
        if (g.length >= 8) {
          const s = g.map((k) => p[k * K + rel]), f = g.map((k) => usable[testRows[k]].fwdRel!);
          ic.push({ di: di[testRows[i]], v: spearman(s, f), year: Number(usable[testRows[i]].date.slice(0, 4)) });
          const order = [...g].sort((a, b) => p[a * K + rel] - p[b * K + rel]);
          const q = Math.max(1, Math.floor(order.length / 5));
          const mean = (arr: number[]) => arr.reduce((s2, k) => s2 + usable[testRows[k]].fwdRel!, 0) / arr.length;
          spread.push({ di: di[testRows[i]], v: (mean(order.slice(-q)) - mean(order.slice(0, q))) * 100 });
          order.forEach((k, pos) => { const d = dec[Math.min(9, Math.floor((pos / order.length) * 10))]; d.n++; d.s += usable[testRows[k]].fwdRel!; });
        }
        i = j;
      }
      const stat = (xs2: Array<{ di: number; v: number }>) => {
        const first = xs2[0]?.di ?? 0;
        const ind = xs2.filter((x) => (x.di - first) % HORIZON === 0).map((x) => x.v);
        const m = xs2.reduce((s2, x) => s2 + x.v, 0) / Math.max(1, xs2.length);
        const im = ind.reduce((s2, x) => s2 + x, 0) / Math.max(1, ind.length);
        const isd = Math.sqrt(ind.reduce((s2, x) => s2 + (x - im) ** 2, 0) / Math.max(1, ind.length - 1));
        return { m, t: isd > 0 ? (im / isd) * Math.sqrt(ind.length) : 0 };
      };
      const a = stat(ic), s = stat(spread);
      const era = (from: number, to: number) => {
        const e = ic.filter((x) => x.year >= from && x.year <= to);
        return e.length ? (e.reduce((s2, x) => s2 + x.v, 0) / e.length).toFixed(3) : "  -  ";
      };
      const strat = strategyBacktest(points, arch.index, null, { horizon: HORIZON, cashYieldPct: 10, costPct: 0.3 });
      const g1 = strat?.legs[3];
      lines.push(
        `rel  IC ${a.m >= 0 ? "+" : ""}${a.m.toFixed(4)} (t ${a.t.toFixed(2)})  spread ${s.m >= 0 ? "+" : ""}${s.m.toFixed(2)}% (t ${s.t.toFixed(2)})  eras 07-12 ${era(2007, 2012)} 13-18 ${era(2013, 2018)} 19-26 ${era(2019, 2026)}` +
          (g1 ? `  gated top5th CAGR ${g1.cagrPct.toFixed(1)}% maxDD ${g1.maxDrawdownPct.toFixed(0)}%` : ""),
        `     deciles ${dec.map((d) => (d.n ? ((d.s / d.n) * 100).toFixed(2) : "-")).join(" ")}`
      );
    }
    for (const [t, name2] of TARGETS.entries()) {
      if (name2 === "rel") continue;
      const col = targetIdx[t];
      const a = auc(testRows.map((k, q) => ({ p: p[q * K + t], y: usable[k].targets![col] })));
      lines.push(`${name2.padEnd(6)} AUC ${a.toFixed(4)}`);
    }
    // Zone pinball: when all six path heads are present.
    const lowCols = LOW_TARGETS.map((c2) => targetIdx.indexOf(c2)), highCols = HIGH_TARGETS.map((c2) => targetIdx.indexOf(c2));
    if (lowCols.every((c2) => c2 >= 0) && highCols.every((c2) => c2 >= 0)) {
      const walk = pathCurve(WALK_CURVE);
      let pm = 0, pw = 0, cnt = 0;
      const hits = { bh: 0, bl: 0, f: 0, sl: 0, sh: 0 };
      const pin = (u: number, tau: number) => u * (tau - (u < 0 ? 1 : 0));
      testRows.forEach((k, q) => {
        const row = usable[k];
        if (row.lowZ == null || row.highZ == null) return;
        const lo = pathCurve(lowCols.map((c2) => p[q * K + c2])), hi = pathCurve(highCols.map((c2) => p[q * K + c2]));
        const D = -row.lowZ, U = row.highZ;
        const qs: Array<[number, number, number, number]> = [
          [D, depthAt(lo, 0.5), depthAt(walk, 0.5), 0.5],
          [D, depthAt(lo, 0.25), depthAt(walk, 0.25), 0.75],
          [D, depthAt(lo, 0.1), depthAt(walk, 0.1), 0.9],
          [U, depthAt(hi, 0.5), depthAt(walk, 0.5), 0.5],
          [U, depthAt(hi, 0.25), depthAt(walk, 0.25), 0.75],
        ];
        for (const [y, m, w, tau] of qs) { pm += pin(y - m, tau); pw += pin(y - w, tau); }
        if (D >= qs[0][1]) hits.bh++;
        if (D >= qs[1][1]) hits.bl++;
        if (D >= qs[2][1]) hits.f++;
        if (U >= qs[3][1]) hits.sl++;
        if (U >= qs[4][1]) hits.sh++;
        cnt++;
      });
      const f = (x: number) => ((x / cnt) * 100).toFixed(0) + "%";
      lines.push(`zones pinball model ${(pm / cnt).toFixed(4)} vs walk ${(pw / cnt).toFixed(4)} (${(((pw - pm) / pw) * 100).toFixed(1)}% better)  reached: buy top ${f(hits.bh)} bottom ${f(hits.bl)} fail ${f(hits.f)} sell bottom ${f(hits.sl)} top ${f(hits.sh)} (built for 50/25/10/50/25)`);
    }
    console.log(`\n== ${name}\n${lines.join("\n")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
