// Turn a price history into rows a model can learn from.
//
// Every feature at day i is computed from days up to and including i, and
// nothing later. The targets for day i are what happened AFTER i. That
// boundary is the whole difference between a forecast and a description, and
// it is enforced here by construction rather than trusted to the caller.
//
// The features are scale-free (returns, ratios, normalised oscillators and
// positions within a range) so a Rs 50 stock and a Rs 5,000 stock feed the
// same network, which is what lets one network be trained on the whole
// KSE-100 at once. The index is included as context because a name rarely
// moves against its market, and the name's return RELATIVE to the index is
// included because that is the part of its move that is its own.

import type { EodBar } from "@/lib/timeseries/psx-eod";

export type FeatureRow = {
  date: string;
  close: number;
  x: number[];
  y: number | null; // 1 if the forward return is positive, 0 if not, null at the tail
  fwdRet: number | null; // forward log return over the horizon, null at the tail
  fwdRel: number | null; // forward log return minus the index's, null at the tail
  targets: number[] | null; // TARGET_NAMES order, null at the tail
};

export const FEATURE_NAMES = [
  // the name's own momentum
  "ret1",
  "ret5",
  "ret10",
  "ret20",
  "ret60",
  "mom12_1",
  // trend structure
  "ma5_20",
  "ma20_50",
  "ma50_200",
  "ma20Slope",
  "ma50Slope",
  // where the price sits
  "rsi14",
  "chan20",
  "chan250",
  "dd250",
  "upDays20",
  // volatility and volume
  "vol20",
  "vol20_60",
  "volRatio",
  "volTrend",
  "vwapGap",
  // relative to the market
  "rel20",
  "rel60",
  // the market itself
  "idxRet1",
  "idxRet5",
  "idxRet20",
  "idxMa50_200",
  "idxVol20",
  "idxDd250",
] as const;

// up:   the close `horizon` sessions on is above today's
// beat: the name's forward return beats the index's over the same sessions
// dip:  some close within the next `horizon` sessions is DIP_PCT below today's
export const TARGET_NAMES = ["up", "beat", "dip"] as const;
export const DIP_PCT = 5;

const clip = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v);
const ln = Math.log;

function smaAt(vals: number[], i: number, n: number): number | null {
  if (i + 1 < n || i < 0) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += vals[k];
  return s / n;
}

function rsiAt(closes: number[], i: number, n = 14): number | null {
  if (i < n) return null;
  let gain = 0, loss = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (gain + loss === 0) return 50;
  const rs = loss === 0 ? 100 : gain / loss;
  return 100 - 100 / (1 + rs);
}

function stdLogRet(closes: number[], i: number, n: number): number | null {
  if (i < n) return null;
  let m = 0;
  const rets = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const j = i - n + 1 + k;
    rets[k] = ln(closes[j] / closes[j - 1]);
    m += rets[k];
  }
  m /= n;
  let v = 0;
  for (const r of rets) v += (r - m) * (r - m);
  return Math.sqrt(v / n);
}

function rangeAt(vals: number[], i: number, n: number): { hi: number; lo: number } {
  let hi = -Infinity, lo = Infinity;
  for (let k = i - n + 1; k <= i; k++) {
    if (vals[k] > hi) hi = vals[k];
    if (vals[k] < lo) lo = vals[k];
  }
  return { hi, lo };
}

const channel = (c: number, r: { hi: number; lo: number }) => (r.hi > r.lo ? (c - r.lo) / (r.hi - r.lo) - 0.5 : 0);

// `context` is an optional per-date vector shared by every name on that date
// (market breadth, macro); it is appended to each row's features unchanged.
export function buildFeatures(bars: EodBar[], index: EodBar[], horizon = 5, context?: Map<string, number[]> | null): FeatureRow[] {
  const byDate = new Map(index.map((b) => [b.date, b]));
  const ctxWidth = context && context.size > 0 ? context.values().next().value!.length : 0;
  const ctxZero = new Array<number>(ctxWidth).fill(0);
  // Only days where the index also traded, so the context is never stale.
  const rows = bars.filter((b) => byDate.has(b.date) && b.close > 0);
  const closes = rows.map((b) => b.close);
  const vols = rows.map((b) => b.volume);
  const vwaps = rows.map((b) => b.vwap);
  const idx = rows.map((b) => byDate.get(b.date)!.close);
  const n = rows.length;

  const out: FeatureRow[] = [];
  for (let i = 0; i < n; i++) {
    // Need 250 days of history behind us for the slow features.
    if (i < 250) continue;
    const c = closes[i];
    const ma5 = smaAt(closes, i, 5)!;
    const ma20 = smaAt(closes, i, 20)!;
    const ma50 = smaAt(closes, i, 50)!;
    const ma200 = smaAt(closes, i, 200)!;
    const ma20Prev = smaAt(closes, i - 5, 20)!;
    const ma50Prev = smaAt(closes, i - 10, 50)!;
    const rsi = rsiAt(closes, i, 14)!;
    const vol20 = stdLogRet(closes, i, 20)!;
    const vol60 = stdLogRet(closes, i, 60)!;
    const r20 = rangeAt(closes, i, 20);
    const r250 = rangeAt(closes, i, 250);
    let ups = 0;
    for (let k = i - 19; k <= i; k++) if (closes[k] > closes[k - 1]) ups++;
    const avgVol20 = smaAt(vols, i, 20) ?? 0;
    const avgVol5 = smaAt(vols, i, 5) ?? 0;
    const volRatio = avgVol20 > 0 && vols[i] > 0 ? ln(vols[i] / avgVol20) : 0;
    const volTrend = avgVol20 > 0 && avgVol5 > 0 ? ln(avgVol5 / avgVol20) : 0;
    const vwapGap = vwaps[i] > 0 ? ln(c / vwaps[i]) : 0;
    const ima50 = smaAt(idx, i, 50)!;
    const ima200 = smaAt(idx, i, 200)!;
    const ivol20 = stdLogRet(idx, i, 20)!;
    const ir250 = rangeAt(idx, i, 250);

    const x = [
      clip(ln(c / closes[i - 1]), 0.15) * 10,
      clip(ln(c / closes[i - 5]), 0.3) * 5,
      clip(ln(c / closes[i - 10]), 0.4) * 4,
      clip(ln(c / closes[i - 20]), 0.5) * 3,
      clip(ln(c / closes[i - 60]), 0.8) * 2,
      clip(ln(closes[i - 20] / closes[i - 250]), 1.2),
      clip(ma5 / ma20 - 1, 0.2) * 10,
      clip(ma20 / ma50 - 1, 0.3) * 6,
      clip(ma50 / ma200 - 1, 0.5) * 4,
      clip(ma20 / ma20Prev - 1, 0.1) * 15,
      clip(ma50 / ma50Prev - 1, 0.1) * 15,
      rsi / 100 - 0.5,
      channel(c, r20),
      channel(c, r250),
      clip(c / r250.hi - 1, 0.6) * 2,
      ups / 20 - 0.5,
      clip(vol20 * Math.sqrt(252), 1.5),
      clip(vol60 > 0 ? ln(vol20 / vol60) : 0, 1.5) / 1.5,
      clip(volRatio, 3) / 3,
      clip(volTrend, 2) / 2,
      clip(vwapGap, 0.05) * 30,
      clip(ln(c / closes[i - 20]) - ln(idx[i] / idx[i - 20]), 0.4) * 4,
      clip(ln(c / closes[i - 60]) - ln(idx[i] / idx[i - 60]), 0.6) * 2.5,
      clip(ln(idx[i] / idx[i - 1]), 0.08) * 15,
      clip(ln(idx[i] / idx[i - 5]), 0.2) * 8,
      clip(ln(idx[i] / idx[i - 20]), 0.4) * 4,
      clip(ima50 / ima200 - 1, 0.4) * 5,
      clip(ivol20 * Math.sqrt(252), 1),
      clip(idx[i] / ir250.hi - 1, 0.5) * 3,
    ];

    if (ctxWidth > 0) x.push(...(context!.get(rows[i].date) ?? ctxZero));

    const hasFuture = i + horizon < n;
    let fwdRet: number | null = null, fwdRel: number | null = null, targets: number[] | null = null;
    if (hasFuture) {
      fwdRet = ln(closes[i + horizon] / c);
      fwdRel = fwdRet - ln(idx[i + horizon] / idx[i]);
      let low = Infinity;
      for (let k = i + 1; k <= i + horizon; k++) if (closes[k] < low) low = closes[k];
      targets = [fwdRet > 0 ? 1 : 0, fwdRel > 0 ? 1 : 0, low <= c * (1 - DIP_PCT / 100) ? 1 : 0];
    }
    out.push({ date: rows[i].date, close: c, x, y: targets ? targets[0] : null, fwdRet, fwdRel, targets });
  }
  return out;
}

// The plain-language trend read that sits beside the model's number. It is
// what a person would say looking at the chart, and it does not depend on any
// training, so it is the part of the message that is always trustworthy.
export type TrendRead = {
  above50: boolean;
  above200: boolean;
  goldenCross: boolean; // 50 over 200
  ma200Rising: boolean;
  offHighPct: number; // negative when below the 250-day high
  ret20Pct: number;
  label: "UPTREND" | "RECOVERING" | "WEAKENING" | "DOWNTREND" | "SIDEWAYS";
  line: string;
  short: string; // fits a chart header
};

export function readTrend(bars: EodBar[]): TrendRead | null {
  const closes = bars.map((b) => b.close);
  const i = closes.length - 1;
  if (i < 250) return null;
  const c = closes[i];
  const ma50 = smaAt(closes, i, 50)!;
  const ma200 = smaAt(closes, i, 200)!;
  const ma200Prev = smaAt(closes, i - 21, 200)!;
  let high = 0;
  for (let k = i - 249; k <= i; k++) if (closes[k] > high) high = closes[k];
  const above50 = c > ma50;
  const above200 = c > ma200;
  const goldenCross = ma50 > ma200;
  const ma200Rising = ma200 > ma200Prev * 1.002;
  const offHighPct = (c / high - 1) * 100;
  const ret20Pct = (c / closes[i - 20] - 1) * 100;

  let label: TrendRead["label"];
  if (above50 && above200 && goldenCross) label = "UPTREND";
  else if (above200 && !above50) label = "WEAKENING";
  else if (!above200 && above50) label = "RECOVERING";
  else if (!above200 && !above50 && !goldenCross) label = "DOWNTREND";
  else label = "SIDEWAYS";

  const line =
    `${label.toLowerCase()}: ${above50 ? "above" : "below"} 50d, ${above200 ? "above" : "below"} 200d` +
    `${goldenCross ? ", 50d over 200d" : ", 50d under 200d"}${ma200Rising ? ", 200d rising" : ""}` +
    `; ${offHighPct.toFixed(1)}% off the 250d high; ${ret20Pct >= 0 ? "+" : ""}${ret20Pct.toFixed(1)}% in 20 sessions`;

  const short =
    `${label} | ${above50 ? "ABOVE" : "BELOW"} 50D, ${above200 ? "ABOVE" : "BELOW"} 200D` +
    ` | ${offHighPct.toFixed(1)}% OFF HIGH | ${ret20Pct >= 0 ? "+" : ""}${ret20Pct.toFixed(1)}% 20D`;
  return { above50, above200, goldenCross, ma200Rising, offHighPct, ret20Pct, label, line, short };
}

// --- small reads used for the cross-sectional lines in the report -----------

// The name's log return over the last n sessions minus the index's, on the
// sessions both traded. Null when there is not enough shared history.
export function relativeReturn(bars: EodBar[], index: EodBar[], n: number): number | null {
  const byDate = new Map(index.map((b) => [b.date, b.close]));
  const shared = bars.filter((b) => byDate.has(b.date) && b.close > 0);
  if (shared.length <= n) return null;
  const a = shared[shared.length - 1], b = shared[shared.length - 1 - n];
  return ln(a.close / b.close) - ln(byDate.get(a.date)! / byDate.get(b.date)!);
}

export function aboveAverage(bars: EodBar[], n: number): boolean | null {
  const closes = bars.map((b) => b.close);
  const i = closes.length - 1;
  const ma = smaAt(closes, i, n);
  return ma == null ? null : closes[i] > ma;
}

// Annualised realised volatility over the last n sessions, in percent.
export function realisedVolPct(bars: EodBar[], n = 20): number | null {
  const closes = bars.map((b) => b.close);
  const s = stdLogRet(closes, closes.length - 1, n);
  return s == null ? null : s * Math.sqrt(252) * 100;
}

// Where today's n-session volatility sits against the same measure over the
// past `lookback` sessions: 0.9 means calmer only 10% of the time.
export function volPercentile(bars: EodBar[], n = 20, lookback = 250): number | null {
  const closes = bars.map((b) => b.close);
  const i = closes.length - 1;
  if (i < n + lookback) return null;
  const today = stdLogRet(closes, i, n)!;
  let below = 0;
  for (let k = i - lookback; k < i; k++) if (stdLogRet(closes, k, n)! < today) below++;
  return below / lookback;
}
