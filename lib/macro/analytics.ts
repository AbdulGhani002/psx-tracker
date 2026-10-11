// What the macro history says, in three parts: how each sector moves with oil,
// the rupee, gold, the policy rate and world stocks (sensitivities); the past
// months most like now and what followed them (analogs); and whether the macro
// state told when stocks would beat T-bills (timing, walked forward). Pure.

import { fitRidge, predictRidge, solve } from "./models";

// --- sensitivities ---------------------------------------------------------

export type Sensitivity = {
  sector: string;
  months: number;
  names: number; // average members a month
  beta: number[]; // per factor: the sector's monthly return against the market per unit move
  t: number[];
  r2: number;
};

// Ordinary least squares of y on the factor columns with an intercept, with
// each slope's t-statistic. Rows with an unknown value are skipped.
export function ols(y: number[], X: number[][]): { beta: number[]; t: number[]; r2: number; n: number } {
  const keep = y.map((v, i) => Number.isFinite(v) && X[i].every(Number.isFinite));
  const ys = y.filter((_, i) => keep[i]), xs = X.filter((_, i) => keep[i]).map((r) => [1, ...r]);
  const n = ys.length, d = xs[0]?.length ?? 1;
  if (n <= d + 2) return { beta: new Array(d - 1).fill(NaN), t: new Array(d - 1).fill(NaN), r2: NaN, n };
  const XtX = Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => xs.reduce((s, r) => s + r[a] * r[b], 0)));
  const Xty = Array.from({ length: d }, (_, a) => xs.reduce((s, r, i) => s + r[a] * ys[i], 0));
  const b = solve(XtX, Xty);
  const fit = xs.map((r) => r.reduce((s, v, j) => s + v * b[j], 0));
  const sse = ys.reduce((s, v, i) => s + (v - fit[i]) ** 2, 0);
  const ym = ys.reduce((s, v) => s + v, 0) / n;
  const sst = ys.reduce((s, v) => s + (v - ym) ** 2, 0);
  const s2 = sse / (n - d);
  // The diagonal of (X'X)^-1, one column at a time.
  const inv = Array.from({ length: d }, (_, j) => solve(XtX, Array.from({ length: d }, (_, q) => (q === j ? 1 : 0)))[j]);
  return { beta: b.slice(1), t: b.slice(1).map((v, j) => v / Math.sqrt(Math.max(1e-18, s2 * inv[j + 1]))), r2: sst > 0 ? 1 - sse / sst : NaN, n };
}

// `monthly`: per month, each sector's return against the market over the
// month and the members it averaged; `factors`: the factors' moves over the
// same months.
export function sectorSensitivities(monthly: Array<{ date: string; sectors: Map<string, { rel: number; n: number }> }>, factors: Map<string, number[]>, minMonths = 60): Sensitivity[] {
  const all = new Set<string>();
  for (const m of monthly) for (const s of m.sectors.keys()) all.add(s);
  const out: Sensitivity[] = [];
  for (const sector of all) {
    const y: number[] = [], X: number[][] = [];
    let names = 0, months = 0;
    for (const m of monthly) {
      const v = m.sectors.get(sector);
      const f = factors.get(m.date);
      if (!v || !f || v.n < 2) continue;
      y.push(v.rel);
      X.push(f);
      names += v.n;
      months++;
    }
    if (months < minMonths) continue;
    const r = ols(y, X);
    out.push({ sector, months, names: names / months, beta: r.beta, t: r.t, r2: r.r2 });
  }
  return out.sort((a, b) => a.sector.localeCompare(b.sector));
}

// --- analogs -----------------------------------------------------------------

export type MonthState = { date: string; x: number[] }; // the standardised state's raw values

export type Analog = { date: string; distance: number };

// The `k` past months nearest to `now` in the state's columns standardised
// over the history, leaving out the year before `now` (whose outcomes overlap
// it) and months whose `need` months of outcome are not all known by then.
export function analogs(history: MonthState[], now: MonthState, k = 8, need = 6): Analog[] {
  const d = now.x.length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0), cnt = new Array(d).fill(0);
  for (const h of history) for (let j = 0; j < d; j++) if (Number.isFinite(h.x[j])) (mean[j] += h.x[j]), cnt[j]++;
  for (let j = 0; j < d; j++) mean[j] = cnt[j] ? mean[j] / cnt[j] : 0;
  for (const h of history) for (let j = 0; j < d; j++) if (Number.isFinite(h.x[j])) sd[j] += (h.x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) sd[j] = cnt[j] > 1 ? Math.sqrt(sd[j] / (cnt[j] - 1)) || 1 : 1;
  const cutoff = new Date(Date.parse(now.date) - 365 * 86400000).toISOString().slice(0, 10);
  const lastUsable = new Date(Date.parse(now.date) - need * 31 * 86400000).toISOString().slice(0, 10);
  const scored: Analog[] = [];
  for (const h of history) {
    if (h.date >= cutoff || h.date > lastUsable) continue;
    let s = 0, used = 0;
    for (let j = 0; j < d; j++) {
      if (!Number.isFinite(h.x[j]) || !Number.isFinite(now.x[j])) continue;
      s += ((h.x[j] - now.x[j]) / sd[j]) ** 2;
      used++;
    }
    if (used >= Math.ceil(d * 0.7)) scored.push({ date: h.date, distance: Math.sqrt(s / used) });
  }
  // One month per episode: neighbours within three months of a nearer one
  // are the same episode.
  const picked: Analog[] = [];
  for (const a of scored.sort((p, q) => p.distance - q.distance)) {
    if (picked.some((p) => Math.abs(Date.parse(p.date) - Date.parse(a.date)) < 92 * 86400000)) continue;
    picked.push(a);
    if (picked.length >= k) break;
  }
  return picked;
}

// --- timing ----------------------------------------------------------------

export type TimingMonth = { date: string; x: number[]; excess: number | null; stock: number | null; cash: number };
export type TimingRecord = { months: number; corr: number; hit: number; cagr: number; maxDd: number; holdCagr: number; holdMaxDd: number; inStocks: number };

// Walked forward a year at a time like the share model: each month's
// prediction of the market's three-month return over T-bills from a ridge
// fitted on months whose outcome was known three months before the year.
// Scored on every third month (no overlap): the prediction's correlation with
// what happened, how often its sign was right, and a book that held stocks
// when it was positive and T-bills when not, against holding stocks always.
export function timingWalk(months: TimingMonth[], fromYear: number, lambda = 20, signal?: (m: TimingMonth, train: TimingMonth[]) => number): { pred: number[]; rec: TimingRecord } {
  const pred = months.map(() => NaN);
  const last = Number(months[months.length - 1].date.slice(0, 4));
  for (let y = fromYear; y <= last; y++) {
    const cut = `${y - 1}-10-01`;
    const train = months.filter((m) => m.date < cut && m.excess != null);
    if (train.length < 36) continue;
    const model = signal ? null : fitRidge(train.map((m) => m.x), train.map((m) => m.excess!), lambda);
    months.forEach((m, i) => {
      if (Number(m.date.slice(0, 4)) === y) pred[i] = model ? predictRidge(model, m.x) : signal!(m, train);
    });
  }
  const scored = months.map((m, i) => ({ m, p: pred[i] })).filter((r) => Number.isFinite(r.p) && r.m.excess != null);
  const every3 = scored.filter((_, k) => k % 3 === 0);
  const ps = every3.map((r) => r.p), ys = every3.map((r) => r.m.excess!);
  const mp = ps.reduce((s, v) => s + v, 0) / ps.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0, dp = 0, dy = 0;
  for (let i = 0; i < ps.length; i++) {
    num += (ps[i] - mp) * (ys[i] - my);
    dp += (ps[i] - mp) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  // The book, three months at a time.
  let book = 1, hold = 1, peak = 1, hpeak = 1, maxDd = 0, holdMaxDd = 0, inStocks = 0;
  for (const r of every3) {
    const stock = r.m.stock ?? 0;
    const g = r.p > 0 ? stock : r.m.cash;
    if (r.p > 0) inStocks++;
    book *= Math.exp(g);
    hold *= Math.exp(stock);
    peak = Math.max(peak, book);
    hpeak = Math.max(hpeak, hold);
    maxDd = Math.min(maxDd, book / peak - 1);
    holdMaxDd = Math.min(holdMaxDd, hold / hpeak - 1);
  }
  const years = (every3.length * 3) / 12;
  return {
    pred,
    rec: {
      months: every3.length,
      corr: dp > 0 && dy > 0 ? num / Math.sqrt(dp * dy) : NaN,
      hit: every3.filter((r) => Math.sign(r.p) === Math.sign(r.m.excess!)).length / Math.max(1, every3.length),
      cagr: years > 0 ? Math.pow(book, 1 / years) - 1 : NaN,
      maxDd,
      holdCagr: years > 0 ? Math.pow(hold, 1 / years) - 1 : NaN,
      holdMaxDd,
      inStocks: every3.length ? inStocks / every3.length : NaN,
    },
  };
}
