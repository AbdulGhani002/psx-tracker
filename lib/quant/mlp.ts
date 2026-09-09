// A small feed-forward network, written out in full so there is nothing in it
// we cannot see. Two tanh hidden layers, a sigmoid output, binary cross-entropy,
// stochastic gradient descent with momentum and L2. Inputs are standardised on
// the TRAINING rows only and the mean and spread are stored with the model, so
// prediction time never sees a statistic it could not have known.
//
// It is deliberately modest. On daily equity returns a bigger network does not
// learn more signal, it learns more noise, and the walk-forward harness that
// sits on top of this is what decides whether it learned anything at all.

export type MlpModel = {
  sizes: number[];
  W: number[][][]; // W[layer][out][in]
  b: number[][]; // b[layer][out]
  mean: number[];
  std: number[];
  epochs: number;
  trainLoss: number;
  valLoss: number;
};

export type TrainOptions = {
  hidden?: number[];
  epochs?: number;
  lr?: number;
  momentum?: number;
  l2?: number;
  batch?: number;
  valFrac?: number; // last slice of the training rows, in time order
  patience?: number;
  seed?: number;
};

// Deterministic RNG, so a run can be reproduced exactly.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function standardiser(X: number[][]): { mean: number[]; std: number[] } {
  const d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(1);
  if (X.length === 0) return { mean, std };
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j];
  for (let j = 0; j < d; j++) mean[j] /= X.length;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / X.length) || 1;
  return { mean, std };
}

function forward(m: { sizes: number[]; W: number[][][]; b: number[][] }, xin: number[]): { acts: number[][]; p: number } {
  const acts: number[][] = [xin];
  let a = xin;
  for (let l = 0; l < m.W.length; l++) {
    const out = new Array(m.sizes[l + 1]);
    const last = l === m.W.length - 1;
    for (let o = 0; o < out.length; o++) {
      let z = m.b[l][o];
      const w = m.W[l][o];
      for (let i = 0; i < a.length; i++) z += w[i] * a[i];
      out[o] = last ? sigmoid(z) : Math.tanh(z);
    }
    acts.push(out);
    a = out;
  }
  return { acts, p: a[0] };
}

function bce(p: number, y: number): number {
  const e = 1e-7;
  const q = p < e ? e : p > 1 - e ? 1 - e : p;
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

export function trainMlp(Xraw: number[][], Y: number[], opts: TrainOptions = {}): MlpModel {
  const hidden = opts.hidden ?? [16, 8];
  const epochs = opts.epochs ?? 200;
  const lr = opts.lr ?? 0.02;
  const mom = opts.momentum ?? 0.9;
  const l2 = opts.l2 ?? 1e-3;
  const batch = opts.batch ?? 32;
  const valFrac = opts.valFrac ?? 0.15;
  const patience = opts.patience ?? 15;
  const rnd = mulberry32(opts.seed ?? 7);

  const d = Xraw[0].length;
  const { mean, std } = standardiser(Xraw);
  const X = Xraw.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));

  // Time-ordered split: the validation slice is the most recent part of the
  // training window, never a random sample, because a random sample would let
  // the model peek at its own future through neighbouring days.
  const nVal = Math.max(20, Math.floor(X.length * valFrac));
  const nTr = X.length - nVal;
  const sizes = [d, ...hidden, 1];

  // Xavier initialisation.
  const W: number[][][] = [];
  const b: number[][] = [];
  const vW: number[][][] = [];
  const vb: number[][] = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const lim = Math.sqrt(6 / (sizes[l] + sizes[l + 1]));
    W.push(Array.from({ length: sizes[l + 1] }, () => Array.from({ length: sizes[l] }, () => (rnd() * 2 - 1) * lim)));
    b.push(new Array(sizes[l + 1]).fill(0));
    vW.push(Array.from({ length: sizes[l + 1] }, () => new Array(sizes[l]).fill(0)));
    vb.push(new Array(sizes[l + 1]).fill(0));
  }
  const model = { sizes, W, b };

  const evalLoss = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += bce(forward(model, X[i]).p, Y[i]);
    return s / Math.max(1, to - from);
  };

  let best = { W: clone3(W), b: clone2(b), val: Infinity, epoch: 0, train: Infinity };
  let stale = 0;
  const order = Array.from({ length: nTr }, (_, i) => i);

  for (let ep = 0; ep < epochs; ep++) {
    // Fisher-Yates on the training indices.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let start = 0; start < nTr; start += batch) {
      const ids = order.slice(start, start + batch);
      // Accumulate gradients over the minibatch.
      const gW = W.map((layer) => layer.map((row) => new Array(row.length).fill(0)));
      const gb = b.map((row) => new Array(row.length).fill(0));
      for (const i of ids) {
        const { acts, p } = forward(model, X[i]);
        // Output delta for sigmoid + BCE is simply p - y.
        let delta = [p - Y[i]];
        for (let l = W.length - 1; l >= 0; l--) {
          const aPrev = acts[l];
          for (let o = 0; o < W[l].length; o++) {
            gb[l][o] += delta[o];
            for (let k = 0; k < aPrev.length; k++) gW[l][o][k] += delta[o] * aPrev[k];
          }
          if (l > 0) {
            const next = new Array(W[l][0].length).fill(0);
            for (let k = 0; k < next.length; k++) {
              let s = 0;
              for (let o = 0; o < W[l].length; o++) s += W[l][o][k] * delta[o];
              const a = acts[l][k];
              next[k] = s * (1 - a * a); // tanh'
            }
            delta = next;
          }
        }
      }
      const n = ids.length;
      for (let l = 0; l < W.length; l++) {
        for (let o = 0; o < W[l].length; o++) {
          for (let k = 0; k < W[l][o].length; k++) {
            const g = gW[l][o][k] / n + l2 * W[l][o][k];
            vW[l][o][k] = mom * vW[l][o][k] - lr * g;
            W[l][o][k] += vW[l][o][k];
          }
          vb[l][o] = mom * vb[l][o] - lr * (gb[l][o] / n);
          b[l][o] += vb[l][o];
        }
      }
    }

    const val = evalLoss(nTr, X.length);
    if (val < best.val - 1e-5) {
      best = { W: clone3(W), b: clone2(b), val, epoch: ep + 1, train: evalLoss(0, nTr) };
      stale = 0;
    } else if (++stale >= patience) {
      break;
    }
  }

  return { sizes, W: best.W, b: best.b, mean, std, epochs: best.epoch, trainLoss: best.train, valLoss: best.val };
}

export function predictMlp(m: MlpModel, xraw: number[]): number {
  const x = xraw.map((v, j) => (v - m.mean[j]) / m.std[j]);
  return forward(m, x).p;
}

const clone2 = (a: number[][]) => a.map((r) => r.slice());
const clone3 = (a: number[][][]) => a.map((l) => l.map((r) => r.slice()));
