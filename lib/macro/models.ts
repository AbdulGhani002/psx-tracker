// Learners and the test for the strategy's model. Every candidate is judged
// the same way: trained on the years before a test year (stopping three months
// short of it, so no target overlaps the test), it scores each month of that
// year, and the scores are compared with what the shares then did against the
// market over the next three months. Pure.

import type { PanelRow } from "./panel";

// --- ridge regression ------------------------------------------------------

export type Ridge = { mean: number[]; sd: number[]; beta: number[]; intercept: number };

// Columns standardised on the training rows; an unknown value counts as the
// column's mean.
export function fitRidge(X: number[][], y: number[], lambda = 10): Ridge {
  const d = X[0].length, n = X.length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0), cnt = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) if (Number.isFinite(r[j])) (mean[j] += r[j]), cnt[j]++;
  for (let j = 0; j < d; j++) mean[j] = cnt[j] ? mean[j] / cnt[j] : 0;
  for (const r of X) for (let j = 0; j < d; j++) if (Number.isFinite(r[j])) sd[j] += (r[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) sd[j] = cnt[j] > 1 ? Math.sqrt(sd[j] / (cnt[j] - 1)) || 1 : 1;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  const z = new Array(d);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) z[j] = Number.isFinite(X[i][j]) ? (X[i][j] - mean[j]) / sd[j] : 0;
    for (let j = 0; j < d; j++) {
      b[j] += z[j] * (y[i] - ym);
      for (let q = j; q < d; q++) A[j][q] += z[j] * z[q];
    }
  }
  for (let j = 0; j < d; j++) {
    for (let q = 0; q < j; q++) A[j][q] = A[q][j];
    A[j][j] += lambda;
  }
  return { mean, sd, beta: solve(A, b), intercept: ym };
}

export function predictRidge(m: Ridge, x: number[]): number {
  let s = m.intercept;
  for (let j = 0; j < m.beta.length; j++) s += m.beta[j] * (Number.isFinite(x[j]) ? (x[j] - m.mean[j]) / m.sd[j] : 0);
  return s;
}

// Gaussian elimination with partial pivoting.
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      if (f) for (let q = c; q <= n; q++) M[r][q] -= f * M[c][q];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let q = r + 1; q < n; q++) s -= M[r][q] * x[q];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

// --- the test --------------------------------------------------------------

export function spearman(a: number[], b: number[]): number {
  const pairs = a.map((v, i) => [v, b[i]] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 5) return NaN;
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length);
    for (let k = 0; k < idx.length; ) {
      let j = k;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++;
      for (let q = k; q <= j; q++) r[idx[q][1]] = (k + j) / 2;
      k = j + 1;
    }
    return r as number[];
  };
  const ra = rank(pairs.map((p) => p[0])), rb = rank(pairs.map((p) => p[1]));
  const n = pairs.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - ma);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - ma) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

export type MonthScore = { date: string; ic: number; spread: number; sectorIc: number; n: number };
export type WalkRecord = {
  months: number;
  ic: number; // mean monthly rank correlation, shares
  icT: number; // its t-statistic on every third month (no overlapping targets)
  spread: number; // best fifth less worst fifth, mean 3-month return against the market
  spreadT: number;
  hit: number; // share of months the best fifth beat the worst
  sectorIc: number; // mean monthly rank correlation of sector averages
  sectorIcT: number;
  byEra: Array<{ from: number; to: number; ic: number; spread: number; sectorIc: number; months: number }>;
};

const meanOf = (xs: number[]) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
const tOf = (xs: number[]) => {
  const v = xs.filter(Number.isFinite);
  if (v.length < 3) return NaN;
  const m = meanOf(v);
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(v.length) : NaN;
};

export function scoreMonths(rows: PanelRow[], pred: number[]): MonthScore[] {
  const byDate = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.fwd3 == null || !Number.isFinite(pred[i])) return;
    (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(i);
  });
  const out: MonthScore[] = [];
  for (const [date, idx] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (idx.length < 10) continue;
    const p = idx.map((i) => pred[i]), y = idx.map((i) => rows[i].fwd3!);
    const order = idx.map((_, k) => k).sort((a, b) => p[a] - p[b]);
    const q = Math.max(1, Math.floor(idx.length / 5));
    const top = meanOf(order.slice(-q).map((k) => y[k])), bot = meanOf(order.slice(0, q).map((k) => y[k]));
    const sectors = new Map<string, { p: number[]; y: number[] }>();
    for (const i of idx) {
      if (!rows[i].sector) continue;
      const s = sectors.get(rows[i].sector) ?? sectors.set(rows[i].sector, { p: [], y: [] }).get(rows[i].sector)!;
      s.p.push(pred[i]);
      s.y.push(rows[i].fwd3!);
    }
    const sec = [...sectors.values()].filter((s) => s.p.length >= 2);
    out.push({ date, ic: spearman(p, y), spread: top - bot, sectorIc: sec.length >= 5 ? spearman(sec.map((s) => meanOf(s.p)), sec.map((s) => meanOf(s.y))) : NaN, n: idx.length });
  }
  return out;
}

export function summarise(months: MonthScore[], eras: Array<[number, number]> = [[2008, 2012], [2013, 2017], [2018, 2022], [2023, 2026]]): WalkRecord {
  const every3 = months.filter((_, k) => k % 3 === 0);
  return {
    months: months.length,
    ic: meanOf(months.map((m) => m.ic)),
    icT: tOf(every3.map((m) => m.ic)),
    spread: meanOf(months.map((m) => m.spread)),
    spreadT: tOf(every3.map((m) => m.spread)),
    hit: months.length ? months.filter((m) => m.spread > 0).length / months.length : NaN,
    sectorIc: meanOf(months.map((m) => m.sectorIc)),
    sectorIcT: tOf(every3.map((m) => m.sectorIc)),
    byEra: eras.map(([from, to]) => {
      const e = months.filter((m) => Number(m.date.slice(0, 4)) >= from && Number(m.date.slice(0, 4)) <= to);
      return { from, to, ic: meanOf(e.map((m) => m.ic)), spread: meanOf(e.map((m) => m.spread)), sectorIc: meanOf(e.map((m) => m.sectorIc)), months: e.length };
    }),
  };
}

// Walk forward a year at a time: each test year's months scored by a model
// fitted on rows dated three months or more before the year began.
export function walkForward(
  rows: PanelRow[],
  fit: (train: PanelRow[]) => (x: number[]) => number,
  o: { fromYear: number; toYear: number; minTrainYears?: number }
): number[] {
  const pred = rows.map(() => NaN);
  for (let y = o.fromYear; y <= o.toYear; y++) {
    const cut = `${y - 1}-10-01`;
    const train = rows.filter((r) => r.date < cut && r.pct3 != null);
    if (train.length < 1000) continue;
    const f = fit(train);
    rows.forEach((r, i) => {
      if (Number(r.date.slice(0, 4)) === y) pred[i] = f(r.x);
    });
  }
  return pred;
}
