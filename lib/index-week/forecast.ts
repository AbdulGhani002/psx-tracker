// Where an index is likely to be over the next week (5 sessions) or month (20
// sessions), from its own closes. Each day's move is measured against how
// jumpy the index has been lately (an exponentially weighted volatility), and
// what followed every past day is kept in those units: the close h sessions on,
// and the lowest and highest close on the way. Today's levels are those
// outcomes' quantiles turned back into points at today's volatility, the
// recent past weighted more than the distant. Nothing here says which way the
// index goes; the levels say how far it usually travels, and the record says
// how often they held. Pure, so scripts/test-index-week.ts runs it.

export type Close = { date: string; close: number };

// `driftHalfLifeDays`: how far back the index's trend is read from (its
// typical move, recent days weighted more); null assumes no trend at all.
export type Params = { lambda: number; halfLifeDays: number; driftHalfLifeDays: number | null };
export const DEFAULT_PARAMS: Params = { lambda: 0.94, halfLifeDays: 500, driftHalfLifeDays: 250 };

// Quantiles each level is set at: the close inside `range` 8 times in 10; the
// lowest close reaching buy[1] half the time and buy[0] 1 time in 5; the
// highest reaching sell[0] half the time and sell[1] 1 time in 5.
export const Q = { rangeLo: 0.1, rangeHi: 0.9, mid: 0.5, buyUsual: 0.5, buyDeep: 0.2, sellUsual: 0.5, sellHigh: 0.8 };

export type Levels = {
  asOf: string;
  close: number;
  sessions: number;
  sigmaPct: number; // the move of one sigma over the horizon, %
  range: [number, number];
  mid: number;
  buy: [number, number]; // [1 in 5, half the time]
  sell: [number, number]; // [half the time, 1 in 5]
};

export type Outcome = { date: string; close: number; low: number; high: number };
export type Hits = { range: boolean; buy: boolean; deep: boolean; sell: boolean; high: boolean; missPct: number };

// The volatility of one day's move as known after each day's close.
export function ewmaSigma(closes: Close[], lambda: number): number[] {
  const n = closes.length;
  const sig = new Array<number>(n).fill(NaN);
  if (n < 22) return sig;
  const r = (k: number) => Math.log(closes[k].close / closes[k - 1].close);
  let v = 0;
  for (let k = 1; k <= 20; k++) v += r(k) ** 2;
  v /= 20;
  sig[20] = Math.sqrt(v);
  for (let k = 21; k < n; k++) {
    v = lambda * v + (1 - lambda) * r(k) ** 2;
    sig[k] = Math.sqrt(v);
  }
  return sig;
}

// What followed each day, in units of that day's volatility over h sessions.
export type Standardised = { t: number; zc: number; zl: number; zh: number };
export function standardise(closes: Close[], sig: number[], h: number): Standardised[] {
  const out: Standardised[] = [];
  for (let t = 20; t + h < closes.length; t++) {
    const s = sig[t] * Math.sqrt(h);
    if (!(s > 0)) continue;
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k <= h; k++) {
      lo = Math.min(lo, closes[t + k].close);
      hi = Math.max(hi, closes[t + k].close);
    }
    const c0 = closes[t].close;
    out.push({ t, zc: Math.log(closes[t + h].close / c0) / s, zl: Math.log(lo / c0) / s, zh: Math.log(hi / c0) / s });
  }
  return out;
}

export function weightedQuantile(values: number[], weights: number[], q: number): number {
  const idx = values.map((_, k) => k).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const k of idx) {
    acc += weights[k];
    if (acc >= q * total) return values[k];
  }
  return values[idx[idx.length - 1]];
}

const round = (v: number) => Math.round(v * 100) / 100;

// The levels on day T, from the outcomes already complete by then.
export function levelsAt(closes: Close[], sig: number[], z: Standardised[], T: number, h: number, p: Params): Levels | null {
  const done = z.filter((x) => x.t + h <= T);
  if (done.length < 120 || !(sig[T] > 0)) return null;
  const w = done.map((x) => Math.pow(0.5, (T - x.t) / p.halfLifeDays));
  // The spread comes from the long record; the trend from the recent one:
  // every outcome is moved so the typical close sits where the recent trend
  // puts it (on today's close where no trend is assumed).
  const zcs = done.map((x) => x.zc);
  const typical = weightedQuantile(zcs, w, 0.5);
  const trend = p.driftHalfLifeDays == null ? 0 : weightedQuantile(zcs, done.map((x) => Math.pow(0.5, (T - x.t) / p.driftHalfLifeDays!)), 0.5);
  const shift = typical - trend;
  const q = (key: "zc" | "zl" | "zh", at: number) => weightedQuantile(done.map((x) => x[key] - shift), w, at);
  const s = sig[T] * Math.sqrt(h);
  const c0 = closes[T].close;
  const lvl = (zv: number) => round(c0 * Math.exp(zv * s));
  return {
    asOf: closes[T].date,
    close: c0,
    sessions: h,
    sigmaPct: round(s * 100),
    range: [lvl(q("zc", Q.rangeLo)), lvl(q("zc", Q.rangeHi))],
    mid: lvl(q("zc", Q.mid)),
    buy: [lvl(q("zl", Q.buyDeep)), lvl(q("zl", Q.buyUsual))],
    sell: [lvl(q("zh", Q.sellUsual)), lvl(q("zh", Q.sellHigh))],
  };
}

export function outcomeAfter(closes: Close[], T: number, h: number): Outcome | null {
  if (T + h >= closes.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (let k = 1; k <= h; k++) {
    lo = Math.min(lo, closes[T + k].close);
    hi = Math.max(hi, closes[T + k].close);
  }
  return { date: closes[T + h].date, close: closes[T + h].close, low: lo, high: hi };
}

export function hitsOf(l: Levels, o: Outcome): Hits {
  return {
    range: o.close >= l.range[0] && o.close <= l.range[1],
    buy: o.low <= l.buy[1],
    deep: o.low <= l.buy[0],
    sell: o.high >= l.sell[0],
    high: o.high >= l.sell[1],
    missPct: round(Math.abs(o.close / l.mid - 1) * 100),
  };
}

// The ISO week a date falls in, "2026-W42".
export function isoWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const wk = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

// The last session of each week that has a following session, by index.
export function weekEnds(closes: Close[]): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < closes.length; k++) if (isoWeek(closes[k].date) !== isoWeek(closes[k + 1].date)) out.push(k);
  return out;
}

export type RecordRow = { levels: Levels; outcome: Outcome; hits: Hits };
export type RecordSummary = { n: number; range: number; buy: number; deep: number; sell: number; high: number; missPct: number; from: string | null; to: string | null };

export function summarise(rows: RecordRow[]): RecordSummary {
  const n = rows.length;
  const share = (f: (h: Hits) => boolean) => (n ? round(rows.filter((r) => f(r.hits)).length / n) : 0);
  const misses = rows.map((r) => r.hits.missPct).sort((a, b) => a - b);
  return {
    n,
    range: share((h) => h.range),
    buy: share((h) => h.buy),
    deep: share((h) => h.deep),
    sell: share((h) => h.sell),
    high: share((h) => h.high),
    missPct: n ? misses[Math.floor((n - 1) / 2)] : 0,
    from: n ? rows[0].levels.asOf : null,
    to: n ? rows[n - 1].levels.asOf : null,
  };
}

// Every week-end's levels against what followed, each using only the days
// before it (a year at least before the first).
export function walkForward(closes: Close[], h: number, p: Params = DEFAULT_PARAMS): RecordRow[] {
  const sig = ewmaSigma(closes, p.lambda);
  const z = standardise(closes, sig, h);
  const rows: RecordRow[] = [];
  for (const T of weekEnds(closes)) {
    if (T < 250) continue;
    const levels = levelsAt(closes, sig, z, T, h, p);
    const outcome = outcomeAfter(closes, T, h);
    if (levels && outcome) rows.push({ levels, outcome, hits: hitsOf(levels, outcome) });
  }
  return rows;
}

// Today's levels.
export function levelsNow(closes: Close[], h: number, p: Params = DEFAULT_PARAMS): Levels | null {
  if (closes.length < 260) return null;
  const sig = ewmaSigma(closes, p.lambda);
  return levelsAt(closes, sig, standardise(closes, sig, h), closes.length - 1, h, p);
}
