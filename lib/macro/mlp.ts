// A small neural network for the strategy's model: inputs standardised on the
// training rows, two hidden layers of rectified units with dropout, one output,
// trained by Adam with decoupled weight decay on squared error, stopped early
// on the newest slice of the training rows (they come in date order). The same
// weights run on the server with predictMlp. Pure, no dependencies.

export type Mlp = {
  sizes: number[]; // input, hidden..., 1
  W: number[][]; // per layer, out x in, row-major
  b: number[][];
  mean: number[];
  sd: number[];
  epochs: number;
  valLoss: number;
};

export type MlpOptions = {
  hidden?: number[];
  lr?: number;
  epochs?: number;
  batch?: number;
  dropout?: number;
  weightDecay?: number;
  valFrac?: number;
  patience?: number;
  seed?: number;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const CLIP = 5;

function standardise(X: number[][], n: number) {
  const d = X[0].length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0), cnt = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const v = X[i][j];
      if (Number.isFinite(v)) {
        mean[j] += v;
        cnt[j]++;
      }
    }
  }
  for (let j = 0; j < d; j++) mean[j] = cnt[j] ? mean[j] / cnt[j] : 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const v = X[i][j];
      if (Number.isFinite(v)) sd[j] += (v - mean[j]) ** 2;
    }
  }
  for (let j = 0; j < d; j++) sd[j] = cnt[j] > 1 ? Math.sqrt(sd[j] / (cnt[j] - 1)) || 1 : 1;
  return { mean, sd };
}

function input(m: Pick<Mlp, "mean" | "sd">, x: number[], out: Float64Array) {
  for (let j = 0; j < out.length; j++) {
    const v = Number.isFinite(x[j]) ? (x[j] - m.mean[j]) / m.sd[j] : 0;
    out[j] = v > CLIP ? CLIP : v < -CLIP ? -CLIP : v;
  }
}

export function predictMlp(m: Mlp, x: number[]): number {
  let a = new Float64Array(m.sizes[0]);
  input(m, x, a);
  for (let l = 0; l < m.W.length; l++) {
    const nOut = m.sizes[l + 1], nIn = m.sizes[l];
    const z = new Float64Array(nOut);
    for (let o = 0; o < nOut; o++) {
      let s = m.b[l][o];
      const row = o * nIn;
      for (let i = 0; i < nIn; i++) s += m.W[l][row + i] * a[i];
      z[o] = l < m.W.length - 1 && s < 0 ? 0 : s;
    }
    a = z;
  }
  return a[0];
}

export function trainMlp(X: number[][], y: number[], o: MlpOptions = {}): Mlp {
  const hidden = o.hidden ?? [64, 32];
  const lr = o.lr ?? 1e-3, epochs = o.epochs ?? 40, batch = o.batch ?? 256;
  const dropout = o.dropout ?? 0.2, wd = o.weightDecay ?? 1e-4, patience = o.patience ?? 6;
  const rand = rng(o.seed ?? 1);
  const n = X.length, d = X[0].length;
  const nVal = Math.max(1, Math.floor(n * (o.valFrac ?? 0.15)));
  const nTr = n - nVal;
  const { mean, sd } = standardise(X, nTr);
  const sizes = [d, ...hidden, 1];
  const L = sizes.length - 1;
  const xs = X.map((r) => {
    const a = new Float64Array(d);
    input({ mean, sd }, r, a);
    return a;
  });
  const ym = y.slice(0, nTr).reduce((s, v) => s + v, 0) / nTr;
  const W: Float64Array[] = [], B: Float64Array[] = [];
  for (let l = 0; l < L; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const w = new Float64Array(nIn * nOut);
    const scale = Math.sqrt(2 / nIn);
    for (let k = 0; k < w.length; k++) {
      // Box-Muller from the seeded generator
      const u = Math.max(1e-12, rand()), v = rand();
      w[k] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * scale * (l === L - 1 ? 0.1 : 1);
    }
    W.push(w);
    B.push(new Float64Array(nOut).fill(l === L - 1 ? ym : 0));
  }
  const mW = W.map((w) => new Float64Array(w.length)), vW = W.map((w) => new Float64Array(w.length));
  const mB = B.map((b) => new Float64Array(b.length)), vB = B.map((b) => new Float64Array(b.length));
  const gW = W.map((w) => new Float64Array(w.length)), gB = B.map((b) => new Float64Array(b.length));
  const acts = sizes.map((s) => new Float64Array(s));
  const masks = sizes.map((s) => new Float64Array(s));
  const deltas = sizes.map((s) => new Float64Array(s));
  let step = 0;

  const forward = (x: Float64Array, train: boolean) => {
    acts[0].set(x);
    for (let l = 0; l < L; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1], w = W[l], a = acts[l], z = acts[l + 1];
      for (let q = 0; q < nOut; q++) {
        let s = B[l][q];
        const row = q * nIn;
        for (let i = 0; i < nIn; i++) s += w[row + i] * a[i];
        if (l < L - 1) {
          s = s < 0 ? 0 : s;
          if (train && dropout > 0) {
            const keep = rand() >= dropout ? 1 / (1 - dropout) : 0;
            masks[l + 1][q] = keep;
            s *= keep;
          } else masks[l + 1][q] = 1;
        }
        z[q] = s;
      }
    }
    return acts[L][0];
  };

  const valLoss = () => {
    let s = 0;
    for (let i = nTr; i < n; i++) s += (forward(xs[i], false) - y[i]) ** 2;
    return s / nVal;
  };

  const snapshot = () => ({ W: W.map((w) => Float64Array.from(w)), B: B.map((b) => Float64Array.from(b)) });
  let best = { loss: Infinity, epoch: 0, ...snapshot() };
  const order = Array.from({ length: nTr }, (_, i) => i);
  let bad = 0, ep = 0;
  for (ep = 1; ep <= epochs; ep++) {
    for (let i = nTr - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let s0 = 0; s0 < nTr; s0 += batch) {
      const s1 = Math.min(nTr, s0 + batch);
      for (const g of gW) g.fill(0);
      for (const g of gB) g.fill(0);
      for (let k = s0; k < s1; k++) {
        const i = order[k];
        const out = forward(xs[i], true);
        deltas[L][0] = (2 * (out - y[i])) / (s1 - s0);
        for (let l = L - 1; l >= 0; l--) {
          const nIn = sizes[l], nOut = sizes[l + 1], w = W[l], a = acts[l], dz = deltas[l + 1];
          const gw = gW[l], gb = gB[l];
          const da = deltas[l];
          if (l > 0) da.fill(0);
          for (let q = 0; q < nOut; q++) {
            const g = dz[q];
            if (g === 0) continue;
            gb[q] += g;
            const row = q * nIn;
            for (let t = 0; t < nIn; t++) {
              gw[row + t] += g * a[t];
              if (l > 0) da[t] += g * w[row + t];
            }
          }
          if (l > 0) for (let t = 0; t < nIn; t++) da[t] = a[t] > 0 ? da[t] * masks[l][t] : 0;
        }
      }
      step++;
      const b1 = 0.9, b2 = 0.999, c1 = 1 - Math.pow(b1, step), c2 = 1 - Math.pow(b2, step);
      for (let l = 0; l < L; l++) {
        const w = W[l], g = gW[l], m1 = mW[l], m2 = vW[l];
        for (let k = 0; k < w.length; k++) {
          m1[k] = b1 * m1[k] + (1 - b1) * g[k];
          m2[k] = b2 * m2[k] + (1 - b2) * g[k] * g[k];
          w[k] -= lr * ((m1[k] / c1) / (Math.sqrt(m2[k] / c2) + 1e-8) + wd * w[k]);
        }
        const bb = B[l], gb = gB[l], n1 = mB[l], n2 = vB[l];
        for (let k = 0; k < bb.length; k++) {
          n1[k] = b1 * n1[k] + (1 - b1) * gb[k];
          n2[k] = b2 * n2[k] + (1 - b2) * gb[k] * gb[k];
          bb[k] -= lr * ((n1[k] / c1) / (Math.sqrt(n2[k] / c2) + 1e-8));
        }
      }
    }
    const v = valLoss();
    if (v < best.loss - 1e-6) {
      best = { loss: v, epoch: ep, ...snapshot() };
      bad = 0;
    } else if (++bad >= patience) break;
  }
  return { sizes, W: best.W.map((w) => Array.from(w)), b: best.B.map((b) => Array.from(b)), mean, sd, epochs: best.epoch, valLoss: best.loss };
}
