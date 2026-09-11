// Where the index is likely to be in `horizon` sessions, from the state it
// is in, with the count of past states behind every number.
//
// The pooled model's direction head is a coin toss over 24 years (AUC 0.49),
// and it printed the same 61% for every name and every index because that is
// the base rate. This is the honest replacement for the index: a table. The
// state is what a person reads off the chart, the index against its 200-day
// average, the slope of that average, and how many names sit above theirs;
// the outcome is what the index did in the `horizon` sessions after every
// past day in that state since 1997: the share that ended higher, the
// quantiles of the move in units of that day's own volatility, the share
// that touched a 5% lower close on the way. Cells with few periods behind
// them are pulled toward their parent cell, and everything is tested
// walk-forward, year by year, against the unconditional table, so the report
// can say whether the state changes the odds at all. A nearest-neighbour
// version on nine features was tried first and did not beat the base rate
// out of sample (Brier skill within a point of zero at 20 sessions, negative
// at 60), which is why the table is coarse on purpose.

export const OUTLOOK_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];
export const DIP_LIMIT = Math.log(0.95); // a 5% lower close on the path

export type IndexBar = { date: string; close: number };

export type IndexState = {
  date: string;
  close: number;
  gap200: number; // log(close / 200-day average)
  gap50: number;
  slope200: number; // log(200-day average / the same 21 sessions earlier)
  ret20: number;
  dd250: number; // log(close / 250-day high), <= 0
  goldenCross: boolean; // 50-day over 200-day
  breadth200: number | null; // share of names above their 200-day, where known
  sigmaH: number; // 60-session daily vol (floored) times root horizon
  fwd: number | null; // log return over the horizon, null at the tail
  z: number | null; // fwd / sigmaH
  minPath: number | null; // lowest close on the path, as a log return from today
  maxPath: number | null;
};

const ln = Math.log;
const SIGMA_FLOOR = 0.004;

function sma(c: number[], i: number, n: number): number {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += c[k];
  return s / n;
}

function stdLog(c: number[], i: number, n: number): number {
  const r = new Array<number>(n);
  let m = 0;
  for (let k = 0; k < n; k++) {
    r[k] = ln(c[i - n + 1 + k] / c[i - n + k]);
    m += r[k];
  }
  m /= n;
  let v = 0;
  for (const x of r) v += (x - m) ** 2;
  return Math.sqrt(v / n);
}

// One state per session from the 251st on.
export function indexStates(bars: IndexBar[], horizon: number, breadth200: Map<string, number> | null = null): IndexState[] {
  const c = bars.map((b) => b.close);
  const n = c.length;
  const out: IndexState[] = [];
  for (let i = 250; i < n; i++) {
    const ma200 = sma(c, i, 200), ma50 = sma(c, i, 50), ma200Prev = sma(c, i - 21, 200);
    let hi = 0;
    for (let k = i - 249; k <= i; k++) if (c[k] > hi) hi = c[k];
    const vol60 = stdLog(c, i, 60);
    const sigmaH = Math.max(SIGMA_FLOOR, vol60) * Math.sqrt(horizon);
    let fwd: number | null = null, minPath: number | null = null, maxPath: number | null = null;
    if (i + horizon < n) {
      fwd = ln(c[i + horizon] / c[i]);
      let lo = Infinity, hg = -Infinity;
      for (let k = i + 1; k <= i + horizon; k++) {
        const r = ln(c[k] / c[i]);
        if (r < lo) lo = r;
        if (r > hg) hg = r;
      }
      minPath = lo;
      maxPath = hg;
    }
    const br = breadth200?.get(bars[i].date);
    out.push({
      date: bars[i].date,
      close: c[i],
      gap200: ln(c[i] / ma200),
      gap50: ln(c[i] / ma50),
      slope200: ln(ma200 / ma200Prev),
      ret20: ln(c[i] / c[i - 20]),
      dd250: ln(c[i] / hi),
      goldenCross: ma50 > ma200,
      breadth200: br == null ? null : br,
      sigmaH,
      fwd,
      z: fwd == null ? null : fwd / sigmaH,
      minPath,
      maxPath,
    });
  }
  return out;
}

// The cells, coarse to fine: the index against its 200-day; then the slope
// of the 200-day; then breadth. A state with unknown breadth stops at the
// second level.
export type CellLevel = 0 | 1 | 2;

export function cellKey(s: Pick<IndexState, "gap200" | "slope200" | "breadth200">, level: CellLevel): string | null {
  const parts = [s.gap200 > 0 ? "above" : "below"];
  if (level >= 1) parts.push(s.slope200 > 0 ? "rising" : "falling");
  if (level >= 2) {
    if (s.breadth200 == null) return null;
    parts.push(s.breadth200 >= 0.5 ? "broad" : "thin");
  }
  return parts.join("|");
}

export function cellLabel(key: string): string {
  const [side, slope, br] = key.split("|");
  const bits = [side === "above" ? "above its 200-day" : "below its 200-day"];
  if (slope) bits.push(slope === "rising" ? "the 200-day rising" : "the 200-day falling");
  if (br) bits.push(br === "broad" ? "most names above theirs" : "most names below theirs");
  return bits.join(", ");
}

export type CellStat = {
  key: string;
  n: number; // states (overlapping sessions)
  periods: number; // n / horizon, the independent count
  pUp: number;
  pDip: number;
  meanZ: number;
  zq: number[]; // OUTLOOK_QUANTILES, in sigma units
};

export type IndexOutlookModel = {
  kind: "cells";
  horizon: number;
  shrink: number; // pseudo-periods pulling a cell toward its parent
  from: string;
  to: string;
  base: CellStat;
  cells: Record<string, CellStat>;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statOf(key: string, states: IndexState[], horizon: number): CellStat {
  const zs = states.map((s) => s.z!).sort((a, b) => a - b);
  const n = states.length;
  return {
    key,
    n,
    periods: n / horizon,
    pUp: n ? states.filter((s) => s.fwd! > 0).length / n : 0.5,
    pDip: n ? states.filter((s) => s.minPath! <= DIP_LIMIT).length / n : 0.3,
    meanZ: n ? zs.reduce((a, b) => a + b, 0) / n : 0,
    zq: OUTLOOK_QUANTILES.map((q) => quantile(zs, q)),
  };
}

export function fitCells(states: IndexState[], horizon: number, shrink = 20): IndexOutlookModel {
  const known = states.filter((s) => s.z != null && Number.isFinite(s.z));
  const groups = new Map<string, IndexState[]>();
  for (const s of known) {
    for (const level of [0, 1, 2] as CellLevel[]) {
      const k = cellKey(s, level);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(s);
      else groups.set(k, [s]);
    }
  }
  const cells: Record<string, CellStat> = {};
  for (const [k, g] of groups) cells[k] = statOf(k, g, horizon);
  return { kind: "cells", horizon, shrink, from: known[0]?.date ?? "", to: known[known.length - 1]?.date ?? "", base: statOf("all", known, horizon), cells };
}

export type CellOutlook = {
  key: string; // the finest cell that had data
  label: string;
  level: CellLevel;
  periods: number; // independent periods in that cell
  pUp: number;
  pDip: number;
  zq: number[];
  levels: number[]; // the quantiles as index levels
  medianPct: number;
  sigmaH: number;
  base: { pUp: number; pDip: number; medianPct: number; periods: number };
  horizon: number;
};

function blend(child: CellStat | undefined, parent: { pUp: number; pDip: number; meanZ: number; zq: number[] }, shrink: number) {
  if (!child) return parent;
  const w = child.periods / (child.periods + shrink);
  return {
    pUp: w * child.pUp + (1 - w) * parent.pUp,
    pDip: w * child.pDip + (1 - w) * parent.pDip,
    meanZ: w * child.meanZ + (1 - w) * parent.meanZ,
    zq: child.zq.map((v, i) => w * v + (1 - w) * parent.zq[i]),
  };
}

// The outlook for a state, using cells down to `level` (finer cells that
// have no data fall back to their parent).
export function cellOutlook(m: IndexOutlookModel, s: Pick<IndexState, "gap200" | "slope200" | "breadth200" | "sigmaH" | "close">, level: CellLevel = 2): CellOutlook {
  let stat: { pUp: number; pDip: number; meanZ: number; zq: number[] } = m.base;
  let used = m.base.key, usedLevel: CellLevel = 0, periods = m.base.periods;
  for (const l of [0, 1, 2] as CellLevel[]) {
    if (l > level) break;
    const k = cellKey(s, l);
    if (!k) break;
    const c = m.cells[k];
    if (!c || c.periods < 1) break;
    stat = blend(c, stat, m.shrink);
    used = k;
    usedLevel = l;
    periods = c.periods;
  }
  const levels = stat.zq.map((z) => s.close * Math.exp(z * s.sigmaH));
  return {
    key: used,
    label: used === "all" ? "all past states" : cellLabel(used),
    level: usedLevel,
    periods,
    pUp: stat.pUp,
    pDip: stat.pDip,
    zq: stat.zq,
    levels,
    medianPct: (Math.exp(stat.zq[2] * s.sigmaH) - 1) * 100,
    sigmaH: s.sigmaH,
    base: { pUp: m.base.pUp, pDip: m.base.pDip, medianPct: (Math.exp(m.base.zq[2] * s.sigmaH) - 1) * 100, periods: m.base.periods },
    horizon: m.horizon,
  };
}

export type OutlookRecord = {
  level: CellLevel;
  from: string;
  to: string;
  n: number; // independent test periods
  brier: number;
  brierBase: number;
  brierSkillPct: number; // 1 - brier / brierBase, in percent
  auc: number;
  dipBrier: number;
  dipBrierBase: number;
  dipSkillPct: number;
  pinballSkillPct: number; // the quantiles against the base quantiles
  cover80: number; // share of outcomes inside the 10-90 band
  cover50: number;
};

const pinball = (q: number, pred: number, actual: number) => (actual >= pred ? q * (actual - pred) : (1 - q) * (pred - actual));

function aucOf(pairs: Array<{ p: number; y: number }>): number {
  const pos = pairs.filter((q) => q.y === 1), neg = pairs.filter((q) => q.y === 0);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

// Walk forward a year at a time: the table is built from every state whose
// outcome was known before the year began, and every `horizon`-th day of the
// year is scored against it and against the unconditional table from the
// same fit. Periods do not overlap.
export function evaluateCells(states: IndexState[], opts: { horizon: number; level: CellLevel; shrink?: number; fromYear?: number }): { record: OutlookRecord; years: Array<{ year: string; n: number; brierSkillPct: number; cover80: number }> } {
  const horizon = opts.horizon;
  const known = states.filter((s) => s.z != null);
  const firstYear = opts.fromYear ?? Number(known[0].date.slice(0, 4)) + 7;
  const lastYear = Number(known[known.length - 1].date.slice(0, 4));
  let brier = 0, brierBase = 0, dipB = 0, dipBase = 0, pin = 0, pinBase = 0, in80 = 0, in50 = 0, n = 0;
  const pairs: Array<{ p: number; y: number }> = [];
  const years: Array<{ year: string; n: number; brierSkillPct: number; cover80: number }> = [];
  let from = "", to = "";
  for (let y = firstYear; y <= lastYear; y++) {
    const yearStart = `${y}-01-01`;
    const before = known.filter((s) => s.date < yearStart);
    // A state whose horizon ends inside the year would leak the year.
    const train = before.slice(0, Math.max(0, before.length - horizon - 5));
    if (train.length < 500) continue;
    const m = fitCells(train, horizon, opts.shrink);
    const test = known.filter((s) => s.date.startsWith(String(y)));
    let yb = 0, ybb = 0, y80 = 0, yn = 0;
    for (let i = 0; i < test.length; i += horizon) {
      const s = test[i];
      const o = cellOutlook(m, s, opts.level);
      const up = s.fwd! > 0 ? 1 : 0, dip = s.minPath! <= DIP_LIMIT ? 1 : 0;
      brier += (o.pUp - up) ** 2; brierBase += (m.base.pUp - up) ** 2;
      dipB += (o.pDip - dip) ** 2; dipBase += (m.base.pDip - dip) ** 2;
      OUTLOOK_QUANTILES.forEach((q, j) => { pin += pinball(q, o.zq[j], s.z!); pinBase += pinball(q, m.base.zq[j], s.z!); });
      if (s.z! >= o.zq[0] && s.z! <= o.zq[4]) { in80++; y80++; }
      if (s.z! >= o.zq[1] && s.z! <= o.zq[3]) in50++;
      pairs.push({ p: o.pUp, y: up });
      yb += (o.pUp - up) ** 2; ybb += (m.base.pUp - up) ** 2;
      yn++; n++;
      if (!from) from = s.date;
      to = s.date;
    }
    if (yn) years.push({ year: String(y), n: yn, brierSkillPct: ybb > 0 ? (1 - yb / ybb) * 100 : 0, cover80: y80 / yn });
  }
  const record: OutlookRecord = {
    level: opts.level,
    from,
    to,
    n,
    brier: brier / Math.max(1, n),
    brierBase: brierBase / Math.max(1, n),
    brierSkillPct: brierBase > 0 ? (1 - brier / brierBase) * 100 : 0,
    auc: aucOf(pairs),
    dipBrier: dipB / Math.max(1, n),
    dipBrierBase: dipBase / Math.max(1, n),
    dipSkillPct: dipBase > 0 ? (1 - dipB / dipBase) * 100 : 0,
    pinballSkillPct: pinBase > 0 ? (1 - pin / pinBase) * 100 : 0,
    cover80: in80 / Math.max(1, n),
    cover50: in50 / Math.max(1, n),
  };
  return { record, years };
}

// The chart tests a person would tick off for market strength.
export type StrengthTest = { name: string; pass: boolean; detail: string };

export function strengthTests(s: Pick<IndexState, "gap200" | "gap50" | "slope200" | "ret20" | "dd250" | "goldenCross" | "breadth200">, breadth50: number | null): StrengthTest[] {
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  return [
    { name: "above its 200-day", pass: s.gap200 > 0, detail: `${pct(s.gap200)} from it` },
    { name: "200-day rising", pass: s.slope200 > 0, detail: `${pct(s.slope200)} in a month` },
    { name: "above its 50-day", pass: s.gap50 > 0, detail: `${pct(s.gap50)} from it` },
    { name: "50-day over 200-day", pass: s.goldenCross, detail: s.goldenCross ? "yes" : "no" },
    { name: "up over 20 sessions", pass: s.ret20 > 0, detail: pct(s.ret20) },
    { name: "within 5% of its 250-day high", pass: s.dd250 > ln(0.95), detail: `${pct(s.dd250)} off it` },
    { name: "half the names above their 200-day", pass: s.breadth200 != null && s.breadth200 >= 0.5, detail: s.breadth200 == null ? "unknown" : `${(s.breadth200 * 100).toFixed(0)}%` },
    { name: "half the names above their 50-day", pass: breadth50 != null && breadth50 >= 0.5, detail: breadth50 == null ? "unknown" : `${(breadth50 * 100).toFixed(0)}%` },
  ];
}
