// PSX-Net's forward pass, for the evening's reading on the server: the network
// is trained on the GPU (ml/psxnet.py) and its weights come here as JSON, so
// the server needs neither Python nor a GPU to use it.
//
// Every operation mirrors the PyTorch module: linear layers, LayerNorm (eps
// 1e-5, biased variance), the tanh form of GELU, attention written out by
// hand with masked keys at -1e9, mean and last-step pooling of the history.
// A parity test (scripts/test-net.ts) holds the two to the same outputs.
//
// The network scores one day's names together: the cross-sectional attention
// reads every name of the day to score each one. Seeds are combined the way
// the walk-forward combined them: the mean of each seed's within-day rank.

export type NetCfg = { dTab: number; C: number; variant: "mlp" | "xs" | "seq" | "full"; d: number; td: number; blocks: number; xs_layers: number; t_layers: number; heads: number; drop: number; L: number };
type Tensor = number[] | number[][];
export type NetWeights = {
  version: 1;
  cfg: NetCfg;
  mean: number[];
  std: number[];
  epochs: number;
  seeds: number;
  trainedTo: string;
  featureNames: string[];
  // Columns read as the day's value rather than the name's rank (the index's
  // own state, trained with --day-raw): the median of the names' raw values.
  dayRaw?: number[];
  models: Array<{ state: Record<string, Tensor>; shapes: Record<string, number[]> }>;
};

// The day's rows as the network reads them: the cross-sectional view, with
// the dayRaw columns replaced by the median of the names' raw readings (as
// ml/psxnet.py does with --day-raw).
export function dayTab(xs: number[][], raw: number[][], cols: number[] | undefined): number[][] {
  if (!cols || cols.length === 0) return xs;
  const out = xs.map((r) => r.slice());
  for (const j of cols) {
    const v = raw.map((r) => r[j]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length === 0) continue;
    const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    for (const r of out) r[j] = med;
  }
  return out;
}

const VARIANTS: Record<NetCfg["variant"], [boolean, boolean]> = { mlp: [false, false], xs: [false, true], seq: [true, false], full: [true, true] };

type Lin = { w: Float64Array; b: Float64Array; out: number; inn: number };
type LN = { w: Float64Array; b: Float64Array };

function lin(state: Record<string, Tensor>, name: string): Lin {
  const w = state[`${name}.weight`] as number[][];
  const b = state[`${name}.bias`] as number[];
  const out = w.length, inn = w[0].length;
  const wf = new Float64Array(out * inn);
  for (let o = 0; o < out; o++) for (let i = 0; i < inn; i++) wf[o * inn + i] = w[o][i];
  return { w: wf, b: Float64Array.from(b), out, inn };
}
const ln = (state: Record<string, Tensor>, name: string): LN => ({ w: Float64Array.from(state[`${name}.weight`] as number[]), b: Float64Array.from(state[`${name}.bias`] as number[]) });

// y[t] = x[t] W^T + b, rows of length inn -> rows of length out
function applyLin(L: Lin, x: Float64Array, rows: number): Float64Array {
  const y = new Float64Array(rows * L.out);
  for (let t = 0; t < rows; t++) {
    const xo = t * L.inn, yo = t * L.out;
    for (let o = 0; o < L.out; o++) {
      let s = L.b[o];
      const wo = o * L.inn;
      for (let i = 0; i < L.inn; i++) s += L.w[wo + i] * x[xo + i];
      y[yo + o] = s;
    }
  }
  return y;
}

function applyLN(P: LN, x: Float64Array, rows: number, d: number): Float64Array {
  const y = new Float64Array(rows * d);
  for (let t = 0; t < rows; t++) {
    let m = 0;
    for (let i = 0; i < d; i++) m += x[t * d + i];
    m /= d;
    let v = 0;
    for (let i = 0; i < d; i++) v += (x[t * d + i] - m) ** 2;
    const inv = 1 / Math.sqrt(v / d + 1e-5);
    for (let i = 0; i < d; i++) y[t * d + i] = (x[t * d + i] - m) * inv * P.w[i] + P.b[i];
  }
  return y;
}

const gelu = (x: number) => 0.5 * x * (1 + Math.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)));

function attention(qkv: Lin, o: Lin, heads: number, x: Float64Array, T: number, d: number, mask: boolean[]): Float64Array {
  const dh = d / heads;
  const p = applyLin(qkv, x, T); // T x 3d: [q | k | v], each split into heads
  const out = new Float64Array(T * d);
  const sc = new Float64Array(T);
  const scale = 1 / Math.sqrt(dh);
  for (let h = 0; h < heads; h++) {
    for (let t1 = 0; t1 < T; t1++) {
      let mx = -Infinity;
      for (let t2 = 0; t2 < T; t2++) {
        let s = 0;
        if (mask[t2]) {
          for (let j = 0; j < dh; j++) s += p[t1 * 3 * d + h * dh + j] * p[t2 * 3 * d + d + h * dh + j];
          s *= scale;
        } else s = -1e9;
        sc[t2] = s;
        if (s > mx) mx = s;
      }
      let z = 0;
      for (let t2 = 0; t2 < T; t2++) z += (sc[t2] = Math.exp(sc[t2] - mx));
      for (let j = 0; j < dh; j++) {
        let s = 0;
        for (let t2 = 0; t2 < T; t2++) s += sc[t2] * p[t2 * 3 * d + 2 * d + h * dh + j];
        out[t1 * d + h * dh + j] = s / z;
      }
    }
  }
  return applyLin(o, out, T);
}

type BlockW = { ln1: LN; ln2: LN; qkv: Lin; o: Lin; f1: Lin; f2: Lin };
const blockW = (s: Record<string, Tensor>, n: string): BlockW => ({ ln1: ln(s, `${n}.ln1`), ln2: ln(s, `${n}.ln2`), qkv: lin(s, `${n}.attn.qkv`), o: lin(s, `${n}.attn.o`), f1: lin(s, `${n}.f1`), f2: lin(s, `${n}.f2`) });

function block(B: BlockW, heads: number, x: Float64Array, T: number, d: number, mask: boolean[]): Float64Array {
  const a = attention(B.qkv, B.o, heads, applyLN(B.ln1, x, T, d), T, d, mask);
  const h = new Float64Array(T * d);
  for (let i = 0; i < h.length; i++) h[i] = x[i] + a[i];
  const f = applyLin(B.f1, applyLN(B.ln2, h, T, d), T);
  for (let i = 0; i < f.length; i++) f[i] = gelu(f[i]);
  const g = applyLin(B.f2, f, T);
  for (let i = 0; i < h.length; i++) h[i] += g[i];
  return h;
}

type ResW = { ln: LN; f1: Lin; f2: Lin };
function resMlp(R: ResW, x: Float64Array, T: number, d: number): Float64Array {
  const f = applyLin(R.f1, applyLN(R.ln, x, T, d), T);
  for (let i = 0; i < f.length; i++) f[i] = gelu(f[i]);
  const g = applyLin(R.f2, f, T);
  const y = new Float64Array(T * d);
  for (let i = 0; i < y.length; i++) y[i] = x[i] + g[i];
  return y;
}

export type NetInput = { tab: number[][]; seq: number[][] }; // per name: raw xs row; flat [L * (C + 1)] history (sequenceAt)

// One seed's scores for one day's names (higher: ranked higher).
export function scoreDay(cfg: NetCfg, state: Record<string, Tensor>, mean: number[], std: number[], input: NetInput): { score: number[]; aux: number[][] } {
  const [useSeq, useXs] = VARIANTS[cfg.variant];
  const N = input.tab.length, d = cfg.d, td = cfg.td, L = cfg.L, C = cfg.C;
  const x = new Float64Array(N * cfg.dTab);
  for (let i = 0; i < N; i++) for (let j = 0; j < cfg.dTab; j++) x[i * cfg.dTab + j] = (input.tab[i][j] - mean[j]) / std[j];
  let h = applyLin(lin(state, "tab_in"), x, N);
  for (let b = 0; b < cfg.blocks; b++) h = resMlp({ ln: ln(state, `tab_blocks.${b}.ln`), f1: lin(state, `tab_blocks.${b}.f1`), f2: lin(state, `tab_blocks.${b}.f2`) }, h, N, d);
  if (useSeq) {
    const inp = lin(state, "temporal.inp");
    const pos = state["temporal.pos"] as number[][];
    const tBlocks = Array.from({ length: cfg.t_layers }, (_, b) => blockW(state, `temporal.blocks.${b}`));
    const tLn = ln(state, "temporal.ln");
    const fuse = lin(state, "fuse");
    const cat = new Float64Array(N * (d + 2 * td));
    for (let i = 0; i < N; i++) {
      const s = input.seq[i];
      const xin = new Float64Array(L * (C + 1));
      const m: boolean[] = [];
      for (let t = 0; t < L; t++) {
        for (let c = 0; c <= C; c++) xin[t * (C + 1) + c] = s[t * (C + 1) + c];
        m.push(s[t * (C + 1) + C] > 0.5);
      }
      let e = applyLin(inp, xin, L);
      for (let t = 0; t < L; t++) for (let j = 0; j < td; j++) e[t * td + j] += pos[t][j];
      for (const B of tBlocks) e = block(B, cfg.heads, e, L, td, m);
      e = applyLN(tLn, e, L, td);
      let cnt = 0;
      const meanPool = new Float64Array(td);
      for (let t = 0; t < L; t++) if (m[t]) { cnt++; for (let j = 0; j < td; j++) meanPool[j] += e[t * td + j]; }
      const o = i * (d + 2 * td);
      for (let j = 0; j < d; j++) cat[o + j] = h[i * d + j];
      for (let j = 0; j < td; j++) cat[o + d + j] = e[(L - 1) * td + j];
      for (let j = 0; j < td; j++) cat[o + d + td + j] = meanPool[j] / Math.max(1, cnt);
    }
    h = applyLin(fuse, cat, N);
  }
  if (useXs) {
    const all = new Array<boolean>(N).fill(true);
    for (let b = 0; b < cfg.xs_layers; b++) h = block(blockW(state, `xs_blocks.${b}`), cfg.heads, h, N, d, all);
  }
  h = applyLN(ln(state, "ln"), h, N, d);
  const score = applyLin(lin(state, "score"), h, N);
  const aux = applyLin(lin(state, "aux"), h, N);
  return { score: Array.from(score), aux: Array.from({ length: N }, (_, i) => [aux[i * 3], aux[i * 3 + 1], aux[i * 3 + 2]].map((z) => 1 / (1 + Math.exp(-z)))) };
}

// The ensemble's reading of a day: each seed's within-day percentile rank,
// averaged. 0 is the bottom of the day, 1 the top.
export function rankDay(w: NetWeights, input: NetInput): number[] {
  const N = input.tab.length;
  const sum = new Array<number>(N).fill(0);
  for (const m of w.models) {
    const { score } = scoreDay(w.cfg, m.state, w.mean, w.std, input);
    const order = score.map((_, i) => i).sort((a, b) => score[a] - score[b]);
    order.forEach((i, pos) => (sum[i] += N > 1 ? pos / (N - 1) : 0.5));
  }
  return sum.map((s) => s / Math.max(1, w.models.length));
}
