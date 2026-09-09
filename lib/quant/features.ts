// Turn a price history into rows a model can learn from.
//
// Every feature at day i is computed from days up to and including i, and
// nothing later. The target for day i is what happened AFTER i. That boundary
// is the whole difference between a forecast and a description, and it is
// enforced here by construction rather than trusted to the caller.
//
// The features are scale-free — ratios, returns, and normalised oscillators —
// so a Rs 50 stock and a Rs 5,000 stock feed the same network, and the index is
// included as context because a name rarely moves against its market.

import type { EodBar } from "@/lib/timeseries/psx-eod";

export type FeatureRow = {
  date: string;
  close: number;
  x: number[];
  y: number | null; // 1 if the forward return is positive, 0 if not, null at the tail
  fwdRet: number | null; // forward log return over the horizon, null at the tail
};

export const FEATURE_NAMES = [
  "ret1",
  "ret5",
  "ret10",
  "ret20",
  "ma5_20",
  "ma20_50",
  "ma50_200",
  "rsi14",
  "vol20",
  "dd250",
  "volRatio",
  "idxRet5",
  "idxRet20",
  "idxMa50_200",
] as const;

const clip = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v);
const ln = Math.log;

function smaAt(vals: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
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
  const rets: number[] = [];
  for (let k = i - n + 1; k <= i; k++) rets.push(ln(closes[k] / closes[k - 1]));
  const m = rets.reduce((s, v) => s + v, 0) / rets.length;
  const v = rets.reduce((s, r) => s + (r - m) * (r - m), 0) / rets.length;
  return Math.sqrt(v);
}

export function buildFeatures(bars: EodBar[], index: EodBar[], horizon = 5): FeatureRow[] {
  const byDate = new Map(index.map((b) => [b.date, b]));
  // Only days where the index also traded, so the context is never stale.
  const rows = bars.filter((b) => byDate.has(b.date) && b.close > 0);
  const closes = rows.map((b) => b.close);
  const vols = rows.map((b) => b.volume);
  const idx = rows.map((b) => byDate.get(b.date)!.close);

  const out: FeatureRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    // Need 250 days of history behind us for the slow features.
    if (i < 250) continue;
    const c = closes[i];
    const ma5 = smaAt(closes, i, 5)!;
    const ma20 = smaAt(closes, i, 20)!;
    const ma50 = smaAt(closes, i, 50)!;
    const ma200 = smaAt(closes, i, 200)!;
    const rsi = rsiAt(closes, i, 14)!;
    const vol20 = stdLogRet(closes, i, 20)!;
    let high250 = 0;
    for (let k = i - 249; k <= i; k++) if (closes[k] > high250) high250 = closes[k];
    const avgVol20 = smaAt(vols, i, 20) ?? 0;
    const volRatio = avgVol20 > 0 && vols[i] > 0 ? ln(vols[i] / avgVol20) : 0;
    const ima50 = smaAt(idx, i, 50)!;
    const ima200 = smaAt(idx, i, 200)!;

    const x = [
      clip(ln(c / closes[i - 1]), 0.15) * 10,
      clip(ln(c / closes[i - 5]), 0.3) * 5,
      clip(ln(c / closes[i - 10]), 0.4) * 4,
      clip(ln(c / closes[i - 20]), 0.5) * 3,
      clip(ma5 / ma20 - 1, 0.2) * 10,
      clip(ma20 / ma50 - 1, 0.3) * 6,
      clip(ma50 / ma200 - 1, 0.5) * 4,
      rsi / 100 - 0.5,
      clip(vol20 * Math.sqrt(252), 1.5),
      clip(c / high250 - 1, 0.6) * 2,
      clip(volRatio, 3) / 3,
      clip(ln(idx[i] / idx[i - 5]), 0.2) * 8,
      clip(ln(idx[i] / idx[i - 20]), 0.4) * 4,
      clip(ima50 / ima200 - 1, 0.4) * 5,
    ];

    const hasFuture = i + horizon < rows.length;
    const fwdRet = hasFuture ? ln(closes[i + horizon] / c) : null;
    out.push({
      date: rows[i].date,
      close: c,
      x,
      y: fwdRet == null ? null : fwdRet > 0 ? 1 : 0,
      fwdRet,
    });
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
