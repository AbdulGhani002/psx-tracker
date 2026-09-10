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

export function trainGbm(Xraw: number[][], y: number[], opts: GbmOptions = {}): GbmModel {
  const rounds = opts.rounds ?? 300;
  const lr = opts.lr ?? 0.05;
  const maxDepth = opts.maxDepth ?? 4;
  const minLeaf = opts.minLeaf ?? 50;
  const lambda = opts.lambda ?? 1;
  const gamma = opts.gamma ?? 0;
  const subsample = opts.subsample ?? 0.7;
  const colsample = opts.colsample ?? 0.8;
  const bins = Math.min(255, opts.bins ?? 64);
  const valFrac = opts.valFrac ?? 0.15;
  const patience = opts.patience ?? 30;
  const earlyStop = opts.earlyStop ?? true;
  const rnd = mulberry32(opts.seed ?? 7);

  const n = Xraw.length;
  const d = Xraw[0].length;
  let nVal = Math.max(20, Math.floor(n * valFrac));
  if (nVal >= n) nVal = Math.max(1, Math.floor(n * 0.2));
  const nTr = n - nVal;

  const cuts = makeCuts(Xraw, nTr, d, bins);
  const nbins = cuts.map((c) => c.length + 1);
  const binned = new Uint8Array(n * d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) binned[i * d + j] = binOf(cuts[j], Xraw[i][j]);

  let pos = 0;
  for (let i = 0; i < nTr; i++) pos += y[i];
  const p0 = Math.min(1 - 1e-4, Math.max(1e-4, pos / nTr));
  const base = Math.log(p0 / (1 - p0));
  const F = new Float64Array(n).fill(base);
  const g = new Float64Array(n);
  const h = new Float64Array(n);

  const maxB = Math.max(...nbins);
  const G = new Float64Array(maxB), H = new Float64Array(maxB), C = new Int32Array(maxB);

  const trees: GbmTree[] = [];
  const treeBins: number[][] = []; // split bins per tree, for the fast update of F
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

    const tree: GbmTree = { feat: [], thr: [], left: [], right: [], value: [] };
    const tbins: number[] = [];
    const rows = Int32Array.from(rowsArr);

    // Grow depth-first. Each node owns a contiguous slice of `rows`, which is
    // partitioned in place when the node splits.
    const grow = (from: number, to: number, depth: number): number => {
      const id = tree.feat.length;
      tree.feat.push(-1); tree.thr.push(0); tree.left.push(-1); tree.right.push(-1); tree.value.push(0); tbins.push(0);
      let Gn = 0, Hn = 0;
      for (let q = from; q < to; q++) { Gn += g[rows[q]]; Hn += h[rows[q]]; }
      const cnt = to - from;
      const leaf = () => { tree.value[id] = (-Gn / (Hn + lambda)) * lr; return id; };
      if (depth >= maxDepth || cnt < 2 * minLeaf) return leaf();

      let bestGain = 0, bestF = -1, bestB = -1;
      const parentScore = (Gn * Gn) / (Hn + lambda);
      for (const f of feats) {
        const nb = nbins[f];
        G.fill(0, 0, nb); H.fill(0, 0, nb); C.fill(0, 0, nb);
        for (let q = from; q < to; q++) {
          const row = rows[q];
          const b = binned[row * d + f];
          G[b] += g[row]; H[b] += h[row]; C[b]++;
        }
        let GL = 0, HL = 0, CL = 0;
        for (let b = 0; b < nb - 1; b++) {
          GL += G[b]; HL += H[b]; CL += C[b];
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
      tree.left[id] = grow(from, mid, depth + 1);
      tree.right[id] = grow(mid, to, depth + 1);
      return id;
    };
    grow(0, rows.length, 0);
    trees.push(tree);
    treeBins.push(tbins);

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
  for (let o = 0; o < k; o++) {
    const fixed = roundsPerTarget?.[o];
    const o2: GbmOptions = fixed != null ? { ...opts, rounds: fixed, earlyStop: false } : opts;
    out.push(trainGbm(X, Y.map((r) => r[o]), { ...o2, seed: (opts.seed ?? 7) + o * 17 }));
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
