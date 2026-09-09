// A small feed-forward network, written out in full so there is nothing in it
// we cannot see. Tanh hidden layers, one sigmoid per output, binary
// cross-entropy, Adam with weight decay, mini-batches, early stopping on a
// time-ordered validation slice. Inputs are standardised on the TRAINING rows
// only and the mean and spread are stored with the model, so prediction time
// never sees a statistic it could not have known.
//
// Several outputs share the hidden layers. "Will it go up", "will it beat the
// index" and "will it dip 5% first" are related questions about the same
// bars, and a network asked all three at once has less room to memorise the
// noise in any one of them.
//
// The arithmetic runs on flat typed arrays with every buffer allocated once,
// because the walk-forward that sits on top of this retrains it dozens of
// times on ninety thousand rows and the first version, on nested arrays,
// spent most of its time in the garbage collector.

export type MlpModel = {
  sizes: number[];
  W: number[][][]; // W[layer][out][in]
  b: number[][]; // b[layer][out]
  mean: number[];
  std: number[];
  outputs: number;
  epochs: number;
  trainLoss: number;
  valLoss: number;
};

export type TrainOptions = {
  hidden?: number[];
  epochs?: number;
  lr?: number;
  momentum?: number; // sgd only
  l2?: number; // weight decay on weights, never on biases
  batch?: number;
  valFrac?: number; // last slice of the training rows, in time order
  patience?: number;
  seed?: number;
  optimizer?: "adam" | "sgd";
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

function bce(p: number, y: number): number {
  const e = 1e-7;
  const q = p < e ? e : p > 1 - e ? 1 - e : p;
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

export function trainMlp(Xraw: number[][], Yraw: number[] | number[][], opts: TrainOptions = {}): MlpModel {
  const hidden = opts.hidden ?? [16, 8];
  const epochs = opts.epochs ?? 100;
  const optimizer = opts.optimizer ?? "adam";
  const lr = opts.lr ?? (optimizer === "adam" ? 5e-3 : 0.02);
  const mom = opts.momentum ?? 0.9;
  const l2 = opts.l2 ?? 1e-4;
  const batch = opts.batch ?? 64;
  const valFrac = opts.valFrac ?? 0.15;
  const patience = opts.patience ?? 10;
  const rnd = mulberry32(opts.seed ?? 7);

  const n = Xraw.length;
  const d = Xraw[0].length;
  const multi = Array.isArray(Yraw[0]);
  const k = multi ? (Yraw[0] as number[]).length : 1;

  // Standardise on the training rows only.
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(1);
  for (const x of Xraw) for (let j = 0; j < d; j++) mean[j] += x[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const x of Xraw) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / n) || 1;

  const X = new Float64Array(n * d);
  const Y = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    const x = Xraw[i];
    for (let j = 0; j < d; j++) X[i * d + j] = (x[j] - mean[j]) / std[j];
    if (multi) for (let o = 0; o < k; o++) Y[i * k + o] = (Yraw[i] as number[])[o];
    else Y[i] = Yraw[i] as number;
  }

  // Time-ordered split: the validation slice is the most recent part of the
  // training window, never a random sample, because a random sample would let
  // the model peek at its own future through neighbouring days.
  let nVal = Math.max(20, Math.floor(n * valFrac));
  if (nVal >= n) nVal = Math.max(1, Math.floor(n * 0.2));
  const nTr = n - nVal;

  const sizes = [d, ...hidden, k];
  const L = sizes.length - 1;
  const w: Float64Array[] = [];
  const bias: Float64Array[] = [];
  const gw: Float64Array[] = [];
  const gb: Float64Array[] = [];
  const mw: Float64Array[] = [], vw: Float64Array[] = [], mb: Float64Array[] = [], vb: Float64Array[] = [];
  const act: Float64Array[] = [new Float64Array(d)];
  const delta: Float64Array[] = [];
  for (let l = 0; l < L; l++) {
    const inn = sizes[l], out = sizes[l + 1];
    const lim = Math.sqrt(6 / (inn + out)); // Xavier
    const wl = new Float64Array(out * inn);
    for (let i = 0; i < wl.length; i++) wl[i] = (rnd() * 2 - 1) * lim;
    w.push(wl);
    bias.push(new Float64Array(out));
    gw.push(new Float64Array(out * inn));
    gb.push(new Float64Array(out));
    mw.push(new Float64Array(out * inn));
    vw.push(new Float64Array(out * inn));
    mb.push(new Float64Array(out));
    vb.push(new Float64Array(out));
    act.push(new Float64Array(out));
    delta.push(new Float64Array(out));
  }

  const forward = (row: number) => {
    act[0].set(X.subarray(row * d, row * d + d));
    for (let l = 0; l < L; l++) {
      const inn = sizes[l], out = sizes[l + 1];
      const wl = w[l], bl = bias[l], a = act[l], next = act[l + 1];
      const last = l === L - 1;
      for (let o = 0; o < out; o++) {
        let z = bl[o];
        const base = o * inn;
        for (let i = 0; i < inn; i++) z += wl[base + i] * a[i];
        next[o] = last ? sigmoid(z) : Math.tanh(z);
      }
    }
  };

  const lossOver = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) {
      forward(i);
      const out = act[L];
      for (let o = 0; o < k; o++) s += bce(out[o], Y[i * k + o]);
    }
    return s / Math.max(1, (to - from) * k);
  };

  const snapshot = () => ({ w: w.map((a) => a.slice()), b: bias.map((a) => a.slice()) });
  let best = { ...snapshot(), val: Infinity, epoch: 0, train: Infinity };
  let stale = 0;
  let step = 0;
  const order = new Int32Array(nTr);
  for (let i = 0; i < nTr; i++) order[i] = i;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;

  for (let ep = 0; ep < epochs; ep++) {
    for (let i = nTr - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    for (let start = 0; start < nTr; start += batch) {
      const end = Math.min(nTr, start + batch);
      const m = end - start;
      for (let l = 0; l < L; l++) { gw[l].fill(0); gb[l].fill(0); }
      for (let q = start; q < end; q++) {
        const row = order[q];
        forward(row);
        // Output delta for sigmoid + BCE is simply p - y.
        const out = act[L], dOut = delta[L - 1];
        for (let o = 0; o < k; o++) dOut[o] = out[o] - Y[row * k + o];
        for (let l = L - 1; l >= 0; l--) {
          const inn = sizes[l], out2 = sizes[l + 1];
          const a = act[l], dl = delta[l], gwl = gw[l], gbl = gb[l];
          for (let o = 0; o < out2; o++) {
            const dv = dl[o];
            gbl[o] += dv;
            const base = o * inn;
            for (let i = 0; i < inn; i++) gwl[base + i] += dv * a[i];
          }
          if (l > 0) {
            const wl = w[l], prev = delta[l - 1];
            for (let i = 0; i < inn; i++) {
              let s = 0;
              for (let o = 0; o < out2; o++) s += wl[o * inn + i] * dl[o];
              prev[i] = s * (1 - a[i] * a[i]); // tanh'
            }
          }
        }
      }
      step++;
      const c1 = 1 - Math.pow(b1, step), c2 = 1 - Math.pow(b2, step);
      for (let l = 0; l < L; l++) {
        const wl = w[l], gwl = gw[l], bl = bias[l], gbl = gb[l];
        if (optimizer === "adam") {
          const m1 = mw[l], v1 = vw[l];
          for (let i = 0; i < wl.length; i++) {
            const g = gwl[i] / m + l2 * wl[i];
            m1[i] = b1 * m1[i] + (1 - b1) * g;
            v1[i] = b2 * v1[i] + (1 - b2) * g * g;
            wl[i] -= (lr * (m1[i] / c1)) / (Math.sqrt(v1[i] / c2) + eps);
          }
          const m2 = mb[l], v2 = vb[l];
          for (let o = 0; o < bl.length; o++) {
            const g = gbl[o] / m;
            m2[o] = b1 * m2[o] + (1 - b1) * g;
            v2[o] = b2 * v2[o] + (1 - b2) * g * g;
            bl[o] -= (lr * (m2[o] / c1)) / (Math.sqrt(v2[o] / c2) + eps);
          }
        } else {
          const v1 = vw[l];
          for (let i = 0; i < wl.length; i++) {
            v1[i] = mom * v1[i] - lr * (gwl[i] / m + l2 * wl[i]);
            wl[i] += v1[i];
          }
          const v2 = vb[l];
          for (let o = 0; o < bl.length; o++) {
            v2[o] = mom * v2[o] - lr * (gbl[o] / m);
            bl[o] += v2[o];
          }
        }
      }
    }

    const val = lossOver(nTr, n);
    if (val < best.val - 1e-5) {
      best = { ...snapshot(), val, epoch: ep + 1, train: lossOver(0, nTr) };
      stale = 0;
    } else if (++stale >= patience) {
      break;
    }
  }

  const W: number[][][] = [];
  const B: number[][] = [];
  for (let l = 0; l < L; l++) {
    const inn = sizes[l], out = sizes[l + 1];
    W.push(Array.from({ length: out }, (_, o) => Array.from(best.w[l].subarray(o * inn, o * inn + inn))));
    B.push(Array.from(best.b[l]));
  }
  return { sizes, W, b: B, mean, std, outputs: k, epochs: best.epoch, trainLoss: best.train, valLoss: best.val };
}

export function predictMlpAll(m: MlpModel, xraw: number[]): number[] {
  let a: number[] = xraw.map((v, j) => (v - m.mean[j]) / m.std[j]);
  for (let l = 0; l < m.W.length; l++) {
    const out = new Array<number>(m.W[l].length);
    const last = l === m.W.length - 1;
    for (let o = 0; o < out.length; o++) {
      let z = m.b[l][o];
      const w = m.W[l][o];
      for (let i = 0; i < a.length; i++) z += w[i] * a[i];
      out[o] = last ? sigmoid(z) : Math.tanh(z);
    }
    a = out;
  }
  return a;
}

export function predictMlp(m: MlpModel, xraw: number[]): number {
  return predictMlpAll(m, xraw)[0];
}
