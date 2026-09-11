// Gradient-boosted decision trees, written out in full.
//
// On tabular data like this (a few dozen engineered features per row, tens or
// hundreds of thousands of rows) boosted trees are what actually wins: they
// handle the interactions and the fat tails without being told about them,
// they do not care about feature scale, and they stop learning noise sooner
// than a network does. The network stays in the ensemble for what it does
// differently; this is what does the heavy lifting.
//
// It is the standard second-order (Newton) boosting on the logistic loss:
// each tree fits the gradient and hessian of the current prediction, leaves
// take the value -G/(H+lambda), splits are scored by the gain in that same
// objective, features are quantised into histogram bins on the training rows
// only, rows and features are subsampled per tree, and early stopping watches
// a time-ordered validation slice. Everything is deterministic given the seed.
// The histograms of a node are filled in one pass over its rows for every
// feature at once, and a node's larger child takes the parent's histograms
// minus the smaller child's, which is what makes ten boosters on six hundred
// thousand rows a matter of minutes.

import { mulberry32 } from "./mlp";

export type GbmTree = { feat: number[]; thr: number[]; left: number[]; right: number[]; value: number[] };

export type GbmModel = {
  trees: GbmTree[];
  base: number; // log-odds of the training base rate
  rounds: number;
  features: number;
  trainLoss: number;
  valLoss: number;
};

export type GbmOptions = {
  rounds?: number;
  lr?: number;
  maxDepth?: number;
  minLeaf?: number;
  lambda?: number; // L2 on leaf values
  gamma?: number; // minimum gain to split
  subsample?: number; // rows per tree
  colsample?: number; // features per tree
  bins?: number;
  valFrac?: number;
  patience?: number;
  seed?: number;
  // false: keep every round and ignore the validation slice. Used for the
  // final model once the round count has been chosen across the walk-forward
  // windows, because one recent slice is a poor judge of how many trees to
  // keep when the market has just changed character.
  earlyStop?: boolean;
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const logloss = (p: number, y: number) => {
  const e = 1e-7;
  const q = p < e ? e : p > 1 - e ? 1 - e : p;
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

// Quantile cut points per feature from the training rows. A value v falls in
// the first bin b with v <= cuts[b], or in the last bin if it is above all.
function makeCuts(Xraw: number[][], nTr: number, d: number, bins: number): number[][] {
  const stride = Math.max(1, Math.floor(nTr / 50000));
  const cuts: number[][] = [];
  for (let j = 0; j < d; j++) {
    const vals: number[] = [];
    for (let i = 0; i < nTr; i += stride) vals.push(Xraw[i][j]);
    vals.sort((a, b) => a - b);
    const c: number[] = [];
    for (let k = 1; k < bins; k++) {
      const v = vals[Math.min(vals.length - 1, Math.floor((k / bins) * vals.length))];
      if (c.length === 0 || v > c[c.length - 1]) c.push(v);
    }
    cuts.push(c);
  }
  return cuts;
}

function binOf(cuts: number[], v: number): number {
  let lo = 0, hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cuts[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo; // 0..cuts.length
}

// The rows binned once, shared by every booster trained on the same matrix
// (one per target): the quantile cuts and the bin of every cell.
export type GbmBinned = { cuts: number[][]; nbins: number[]; binned: Uint8Array; n: number; d: number; nTr: number };

export function binRows(Xraw: number[][], opts: GbmOptions = {}): GbmBinned {
  const bins = Math.min(255, opts.bins ?? 64);
  const valFrac = opts.valFrac ?? 0.15;
  const n = Xraw.length;
  const d = Xraw[0].length;
  let nVal = Math.max(20, Math.floor(n * valFrac));
  if (nVal >= n) nVal = Math.max(1, Math.floor(n * 0.2));
  const nTr = n - nVal;
  const cuts = makeCuts(Xraw, nTr, d, bins);
  const nbins = cuts.map((c) => c.length + 1);
  const binned = new Uint8Array(n * d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) binned[i * d + j] = binOf(cuts[j], Xraw[i][j]);
  return { cuts, nbins, binned, n, d, nTr };
}

export function trainGbm(Xraw: number[][], y: number[], opts: GbmOptions = {}, pre?: GbmBinned): GbmModel {
  const rounds = opts.rounds ?? 300;
  const lr = opts.lr ?? 0.05;
  const maxDepth = opts.maxDepth ?? 4;
  const minLeaf = opts.minLeaf ?? 50;
  const lambda = opts.lambda ?? 1;
  const gamma = opts.gamma ?? 0;
  const subsample = opts.subsample ?? 0.7;
  const colsample = opts.colsample ?? 0.8;
  const patience = opts.patience ?? 30;
  const earlyStop = opts.earlyStop ?? true;
  const rnd = mulberry32(opts.seed ?? 7);

  const { cuts, nbins, binned, n, d, nTr } = pre ?? binRows(Xraw, opts);

  let pos = 0;
  for (let i = 0; i < nTr; i++) pos += y[i];
  const p0 = Math.min(1 - 1e-4, Math.max(1e-4, pos / nTr));
  const base = Math.log(p0 / (1 - p0));
  const F = new Float64Array(n).fill(base);
  const g = new Float64Array(n);
  const h = new Float64Array(n);

  // Histograms for every feature of one node, laid out feature-major with a
  // fixed stride, one set per depth plus a spare per depth for the sibling
  // whose histogram is the parent's minus the other child's.
  const HB = Math.max(...nbins);
  const lvlG: Float64Array[] = [], lvlH: Float64Array[] = [], lvlC: Int32Array[] = [];
  const sibG: Float64Array[] = [], sibH: Float64Array[] = [], sibC: Int32Array[] = [];
  for (let l = 0; l <= maxDepth + 1; l++) {
    lvlG.push(new Float64Array(d * HB)); lvlH.push(new Float64Array(d * HB)); lvlC.push(new Int32Array(d * HB));
    sibG.push(new Float64Array(d * HB)); sibH.push(new Float64Array(d * HB)); sibC.push(new Int32Array(d * HB));
  }

  const trees: GbmTree[] = [];
  let best = { val: Infinity, rounds: 0, train: Infinity };
  let stale = 0;

  const lossOver = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += logloss(sigmoid(F[i]), y[i]);
    return s / Math.max(1, to - from);
  };

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < nTr; i++) {
      const p = sigmoid(F[i]);
      g[i] = p - y[i];
      h[i] = Math.max(1e-6, p * (1 - p));
    }
    const rowsArr: number[] = [];
    for (let i = 0; i < nTr; i++) if (rnd() < subsample) rowsArr.push(i);
    if (rowsArr.length < 2 * minLeaf) for (let i = 0; i < nTr; i++) rowsArr.push(i);
    const feats: number[] = [];
    for (let j = 0; j < d; j++) if (rnd() < colsample) feats.push(j);
    if (feats.length === 0) feats.push(Math.floor(rnd() * d));
    const nf = feats.length;

    const tree: GbmTree = { feat: [], thr: [], left: [], right: [], value: [] };
    const tbins: number[] = [];
    const rows = Int32Array.from(rowsArr);

    // One pass over the node's rows fills the histograms of every sampled
    // feature at once; the row's bins sit next to each other in memory.
    const buildHist = (from: number, to: number, G: Float64Array, H: Float64Array, C: Int32Array) => {
      G.fill(0); H.fill(0); C.fill(0);
      for (let q = from; q < to; q++) {
        const row = rows[q];
        const base0 = row * d;
        const gr = g[row], hr = h[row];
        for (let k = 0; k < nf; k++) {
          const f = feats[k];
          const idx = f * HB + binned[base0 + f];
          G[idx] += gr; H[idx] += hr; C[idx]++;
        }
      }
    };
    const subtractInto = (pG: Float64Array, pH: Float64Array, pC: Int32Array, sG: Float64Array, sH: Float64Array, sC: Int32Array, oG: Float64Array, oH: Float64Array, oC: Int32Array) => {
      for (let k = 0; k < nf; k++) {
        const b0 = feats[k] * HB, b1 = b0 + nbins[feats[k]];
        for (let i = b0; i < b1; i++) { oG[i] = pG[i] - sG[i]; oH[i] = pH[i] - sH[i]; oC[i] = pC[i] - sC[i]; }
      }
    };

    // Grow depth-first. Each node owns a contiguous slice of `rows`, which is
    // partitioned in place when the node splits. `histReady` says the node's
    // histograms are already in the arrays for its depth.
    const grow = (from: number, to: number, depth: number, histReady: boolean): number => {
      const id = tree.feat.length;
      tree.feat.push(-1); tree.thr.push(0); tree.left.push(-1); tree.right.push(-1); tree.value.push(0); tbins.push(0);
      let Gn = 0, Hn = 0;
      for (let q = from; q < to; q++) { Gn += g[rows[q]]; Hn += h[rows[q]]; }
      const cnt = to - from;
      const leaf = () => { tree.value[id] = (-Gn / (Hn + lambda)) * lr; return id; };
      if (depth >= maxDepth || cnt < 2 * minLeaf) return leaf();

      const G = lvlG[depth], H = lvlH[depth], C = lvlC[depth];
      if (!histReady) buildHist(from, to, G, H, C);
      let bestGain = 0, bestF = -1, bestB = -1;
      const parentScore = (Gn * Gn) / (Hn + lambda);
      for (let k = 0; k < nf; k++) {
        const f = feats[k];
        const nb = nbins[f];
        const b0 = f * HB;
        let GL = 0, HL = 0, CL = 0;
        for (let b = 0; b < nb - 1; b++) {
          GL += G[b0 + b]; HL += H[b0 + b]; CL += C[b0 + b];
          if (CL < minLeaf) continue;
          if (cnt - CL < minLeaf) break;
          const GR = Gn - GL, HR = Hn - HL;
          const gain = 0.5 * ((GL * GL) / (HL + lambda) + (GR * GR) / (HR + lambda) - parentScore) - gamma;
          if (gain > bestGain) { bestGain = gain; bestF = f; bestB = b; }
        }
      }
      if (bestF < 0) return leaf();

      // Partition: rows with bin <= bestB go left.
      let i = from, j = to - 1;
      while (i <= j) {
        if (binned[rows[i] * d + bestF] <= bestB) i++;
        else { const t = rows[i]; rows[i] = rows[j]; rows[j] = t; j--; }
      }
      const mid = i;
      if (mid === from || mid === to) return leaf();
      tree.feat[id] = bestF;
      tree.thr[id] = cuts[bestF][bestB];
      tbins[id] = bestB;

      // The smaller child's histograms are built; the larger child's are the
      // parent's minus them. Children that will be leaves need neither.
      const canSplit = (a: number, b: number) => depth + 1 < maxDepth && b - a >= 2 * minLeaf;
      const leftSmall = mid - from <= to - mid;
      const sFrom = leftSmall ? from : mid, sTo = leftSmall ? mid : to;
      const bFrom = leftSmall ? mid : from, bTo = leftSmall ? to : mid;
      const smallReady = canSplit(sFrom, sTo) || canSplit(bFrom, bTo);
      if (smallReady) buildHist(sFrom, sTo, lvlG[depth + 1], lvlH[depth + 1], lvlC[depth + 1]);
      const bigReady = canSplit(bFrom, bTo);
      if (bigReady) subtractInto(G, H, C, lvlG[depth + 1], lvlH[depth + 1], lvlC[depth + 1], sibG[depth + 1], sibH[depth + 1], sibC[depth + 1]);
      const smallId = grow(sFrom, sTo, depth + 1, smallReady);
      if (bigReady) { lvlG[depth + 1].set(sibG[depth + 1]); lvlH[depth + 1].set(sibH[depth + 1]); lvlC[depth + 1].set(sibC[depth + 1]); }
      const bigId = grow(bFrom, bTo, depth + 1, bigReady);
      tree.left[id] = leftSmall ? smallId : bigId;
      tree.right[id] = leftSmall ? bigId : smallId;
      return id;
    };
    grow(0, rows.length, 0, false);
    trees.push(tree);

    // Update every row's score with the new tree, walking on bins.
    for (let i = 0; i < n; i++) {
      let node = 0;
      while (tree.left[node] >= 0) node = binned[i * d + tree.feat[node]] <= tbins[node] ? tree.left[node] : tree.right[node];
      F[i] += tree.value[node];
    }

    if (!earlyStop) continue;
    const val = lossOver(nTr, n);
    if (val < best.val - 1e-6) {
      best = { val, rounds: r + 1, train: lossOver(0, nTr) };
      stale = 0;
    } else if (++stale >= patience) break;
  }

  if (!earlyStop) return { trees, base, rounds: trees.length, features: d, trainLoss: lossOver(0, nTr), valLoss: lossOver(nTr, n) };
  return { trees: trees.slice(0, best.rounds), base, rounds: best.rounds, features: d, trainLoss: best.train, valLoss: best.val };
}

export function predictGbmLogit(m: GbmModel, x: number[]): number {
  let s = m.base;
  for (const t of m.trees) {
    let node = 0;
    while (t.left[node] >= 0) node = x[t.feat[node]] <= t.thr[node] ? t.left[node] : t.right[node];
    s += t.value[node];
  }
  return s;
}

export function predictGbm(m: GbmModel, x: number[]): number {
  return sigmoid(predictGbmLogit(m, x));
}

// One booster per target column. `roundsPerTarget` fixes each booster's
// round count (no early stopping), for the final model.
export function trainGbmMulti(X: number[][], Y: number[][], opts: GbmOptions = {}, roundsPerTarget?: number[]): GbmModel[] {
  const k = Y[0].length;
  const out: GbmModel[] = [];
  const pre = binRows(X, opts);
  for (let o = 0; o < k; o++) {
    const fixed = roundsPerTarget?.[o];
    const o2: GbmOptions = fixed != null ? { ...opts, rounds: fixed, earlyStop: false } : opts;
    out.push(trainGbm(X, Y.map((r) => r[o]), { ...o2, seed: (opts.seed ?? 7) + o * 17 }, pre));
  }
  return out;
}

// Which features the trees split on, weighted by gain-free split counts. A
// cheap read of what the model is looking at.
export function gbmFeatureUse(models: GbmModel[]): number[] {
  const d = models[0]?.features ?? 0;
  const use = new Array<number>(d).fill(0);
  for (const m of models) for (const t of m.trees) for (const f of t.feat) if (f >= 0) use[f]++;
  const total = use.reduce((s, v) => s + v, 0) || 1;
  return use.map((v) => v / total);
}
