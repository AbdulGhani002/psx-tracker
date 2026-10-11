// The monthly panel the strategy's model learns from: at each month's end, for
// every share in that year's liquid universe, what was known then (its own
// momentum, risk, dividend yield and size; its sector's; the macro state; and
// its measured sensitivity to oil, the rupee, gold, rates and world stocks
// times how those have just moved) beside what came next (its return over the
// next one, three and six months against the market). Pure, so the research
// script and the tests run it.

import type { EodBar } from "@/lib/timeseries/psx-eod";

export const STOCK_NAMES = [
  "rel1", "rel3", "rel6", "rel12_1", "vol3", "dd12", "dy", "liq",
  "rel3Rank", "rel12Rank", "dyRank", "volRank", "liqRank",
] as const;
export const SECTOR_NAMES = ["secRel3", "secRel12", "secDy", "secRel3Rank", "secRel12Rank", "secN"] as const;
export const FACTORS = ["oil", "pkr", "gold", "policy", "spx"] as const;
export const SENS_NAMES = [...FACTORS.map((f) => `beta_${f}`), ...FACTORS.map((f) => `push_${f}`)] as const;

export type PanelRow = {
  date: string;
  symbol: string;
  sector: string;
  x: number[]; // STOCK_NAMES, SECTOR_NAMES, macro names, SENS_NAMES (NaN unknown)
  fwd1: number | null; // log return over 21 sessions, less the market's
  fwd3: number | null; // 63 sessions
  fwd6: number | null; // 126 sessions
  pct3: number | null; // fwd3 as a percentile within the month
};

export type PanelInput = {
  bars: Map<string, EodBar[]>; // adjusted daily bars
  dividends: Map<string, Array<{ date: string; yieldPct: number }>>; // cash, at the ex-date price
  dividendsKnown?: (date: string) => boolean; // false: the record has a gap there, so yields are unknown, not zero
  sectorOf: (symbol: string) => string | null;
  members: (date: string) => Set<string> | null; // the liquid universe then
  market: EodBar[]; // the equal-weight index
  monthEnds: string[]; // last session of each month
  macro: (date: string) => Array<number | null>; // macroState, MACRO_NAMES order
  factorMonthly: (date: string) => Record<(typeof FACTORS)[number], number | null>; // each factor's move over the month to `date`
  factorPush: (date: string) => Record<(typeof FACTORS)[number], number | null>; // its move over the last three months
  betaMonths?: number; // sensitivity window, default 36
};

const DAY = 86400000;

// Index of the last bar on or before `date`, or -1.
export function barAt(b: EodBar[], date: string): number {
  let lo = 0, hi = b.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid].date <= date) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at;
}

const lr = (b: EodBar[], i: number, back: number) => (i - back >= 0 && b[i - back].close > 0 && b[i].close > 0 ? Math.log(b[i].close / b[i - back].close) : NaN);

// Within-month percentile ranks (0 to 1) of one column; NaN stays NaN.
export function ranks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as [number, number]).filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const out = values.map(() => NaN);
  const n = idx.length;
  for (let k = 0; k < n; ) {
    let j = k;
    while (j + 1 < n && idx[j + 1][0] === idx[k][0]) j++;
    const r = n > 1 ? (k + j) / 2 / (n - 1) : 0.5;
    for (let q = k; q <= j; q++) out[idx[q][1]] = r;
    k = j + 1;
  }
  return out;
}

function stdev(xs: number[]): number {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

// The univariate least-squares slope of y on x over paired finite values.
export function slope(y: number[], x: number[]): number {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i]) || !Number.isFinite(x[i])) continue;
    n++;
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
  }
  const v = sxx - (sx * sx) / Math.max(1, n);
  return n >= 12 && v > 0 ? (sxy - (sx * sy) / n) / v : NaN;
}

export function buildPanel(p: PanelInput): PanelRow[] {
  const W = p.betaMonths ?? 36;
  const months = p.monthEnds;
  const mAt = months.map((d) => barAt(p.market, d));
  // Each name's monthly return against the market, month by month, for the
  // sensitivities.
  const monthlyRel = new Map<string, number[]>();
  for (const [s, b] of p.bars) {
    const out = months.map(() => NaN);
    let prev = -1;
    for (let k = 0; k < months.length; k++) {
      const i = barAt(b, months[k]);
      if (i >= 0 && Date.parse(months[k]) - Date.parse(b[i].date) > 7 * DAY) {
        prev = -1;
        continue;
      }
      if (i >= 0 && prev >= 0 && k > 0 && mAt[k] > 0 && mAt[k - 1] >= 0 && b[prev].close > 0) {
        out[k] = Math.log(b[i].close / b[prev].close) - Math.log(p.market[mAt[k]].close / p.market[mAt[k - 1]].close);
      }
      prev = i;
    }
    monthlyRel.set(s, out);
  }
  const factorSeries = months.map((d) => p.factorMonthly(d));

  const rows: PanelRow[] = [];
  for (let k = 0; k < months.length; k++) {
    const date = months[k];
    const mi = mAt[k];
    if (mi < 252) continue;
    const universe = p.members(date);
    if (!universe) continue;
    const m = p.market;
    const mret = (back: number) => lr(m, mi, back);
    const mFwd = (ahead: number) => (mi + ahead < m.length ? Math.log(m[mi + ahead].close / m[mi].close) : NaN);
    const macro = p.macro(date).map((v) => (v == null ? NaN : v));
    const push = p.factorPush(date);

    const month: Array<{ s: string; sector: string; f: Record<string, number>; fwd: [number, number, number] }> = [];
    for (const s of universe) {
      const b = p.bars.get(s);
      if (!b) continue;
      const i = barAt(b, date);
      if (i < 252 || Date.parse(date) - Date.parse(b[i].date) > 7 * DAY) continue;
      const rets: number[] = [];
      for (let j = i - 62; j <= i; j++) rets.push(Math.log(b[j].close / b[j - 1].close));
      let hi = 0;
      for (let j = i - 251; j <= i; j++) hi = Math.max(hi, b[j].close);
      const tv: number[] = [];
      for (let j = i - 62; j <= i; j++) tv.push(b[j].close * b[j].volume);
      tv.sort((a, c) => a - c);
      const from = new Date(Date.parse(date) - 365 * DAY).toISOString().slice(0, 10);
      const dy = p.dividendsKnown && !p.dividendsKnown(date) ? NaN : (p.dividends.get(s) ?? []).filter((d) => d.date > from && d.date <= date).reduce((a, d) => a + d.yieldPct, 0);
      const f: Record<string, number> = {
        rel1: lr(b, i, 21) - mret(21),
        rel3: lr(b, i, 63) - mret(63),
        rel6: lr(b, i, 126) - mret(126),
        rel12_1: lr(b, i - 21, 231) - (mi >= 252 ? Math.log(m[mi - 21].close / m[mi - 252].close) : NaN),
        vol3: stdev(rets) * Math.sqrt(252),
        dd12: hi > 0 ? b[i].close / hi - 1 : NaN,
        dy,
        liq: tv[Math.floor(tv.length / 2)] > 0 ? Math.log(tv[Math.floor(tv.length / 2)]) : NaN,
      };
      // The sensitivities from the months before this one only.
      const rel = monthlyRel.get(s)!;
      for (const fac of FACTORS) {
        const ys: number[] = [], xs: number[] = [];
        for (let q = Math.max(1, k - W + 1); q <= k; q++) {
          ys.push(rel[q]);
          xs.push(factorSeries[q][fac] ?? NaN);
        }
        const beta = slope(ys, xs);
        f[`beta_${fac}`] = beta;
        f[`push_${fac}`] = Number.isFinite(beta) && push[fac] != null ? beta * push[fac]! : NaN;
      }
      const fwd = (ahead: number) => (i + ahead < b.length && Number.isFinite(mFwd(ahead)) ? Math.log(b[i + ahead].close / b[i].close) - mFwd(ahead) : NaN);
      month.push({ s, sector: p.sectorOf(s) ?? "", f, fwd: [fwd(21), fwd(63), fwd(126)] });
    }
    if (month.length < 10) continue;

    // Ranks within the month, then the sector's averages.
    const col = (n: string) => month.map((r) => r.f[n]);
    const rk = { rel3Rank: ranks(col("rel3")), rel12Rank: ranks(col("rel12_1")), dyRank: ranks(col("dy")), volRank: ranks(col("vol3")), liqRank: ranks(col("liq")) };
    month.forEach((r, q) => Object.assign(r.f, { rel3Rank: rk.rel3Rank[q], rel12Rank: rk.rel12Rank[q], dyRank: rk.dyRank[q], volRank: rk.volRank[q], liqRank: rk.liqRank[q] }));
    const bySector = new Map<string, typeof month>();
    for (const r of month) if (r.sector) (bySector.get(r.sector) ?? bySector.set(r.sector, []).get(r.sector)!).push(r);
    const mean = (xs: number[]) => {
      const v = xs.filter(Number.isFinite);
      return v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN;
    };
    const median = (xs: number[]) => {
      const v = xs.filter(Number.isFinite).sort((a, c) => a - c);
      return v.length ? v[Math.floor(v.length / 2)] : NaN;
    };
    const secKeys = [...bySector.keys()];
    const sec3 = secKeys.map((s) => mean(bySector.get(s)!.map((r) => r.f.rel3)));
    const sec12 = secKeys.map((s) => mean(bySector.get(s)!.map((r) => r.f.rel12_1)));
    const sec3Rank = ranks(sec3), sec12Rank = ranks(sec12);
    const secOf = new Map(secKeys.map((s, q) => [s, { secRel3: sec3[q], secRel12: sec12[q], secDy: median(bySector.get(s)!.map((r) => r.f.dy)), secRel3Rank: sec3Rank[q], secRel12Rank: sec12Rank[q], secN: bySector.get(s)!.length }]));

    const pct = ranks(month.map((r) => r.fwd[1]));
    month.forEach((r, q) => {
      const sf = secOf.get(r.sector) ?? { secRel3: NaN, secRel12: NaN, secDy: NaN, secRel3Rank: NaN, secRel12Rank: NaN, secN: 0 };
      const x = [...STOCK_NAMES.map((n) => r.f[n]), ...SECTOR_NAMES.map((n) => sf[n]), ...macro, ...SENS_NAMES.map((n) => r.f[n])];
      const fin = (v: number) => (Number.isFinite(v) ? v : null);
      rows.push({ date, symbol: r.s, sector: r.sector, x, fwd1: fin(r.fwd[0]), fwd3: fin(r.fwd[1]), fwd6: fin(r.fwd[2]), pct3: fin(pct[q]) });
    });
  }
  return rows;
}
