// Where the model thinks a price is going, as levels a person can act on.
//
// The model gives two probabilities: that the close is higher in `horizon`
// sessions, and that a 5% lower close arrives first. This turns them into a
// range. The spread comes from the name's own recent volatility; the tilt
// comes from the model's odds, read through a normal curve (63% odds higher
// puts the centre a third of a standard deviation above today). It is an
// honest translation, not a prophecy: the band is where one standard
// deviation lands, so about a third of outcomes fall outside it.
//
// Beside the range go the levels the chart itself carries: the 50- and
// 200-day averages, the 250-day high, the 20-day low and high. Those are the
// points where buying and selling actually clusters, and they are the same
// whichever model is in fashion.

import type { EodBar } from "@/lib/timeseries/psx-eod";

export type Projection = {
  horizon: number;
  level: number;
  sigmaDaily: number; // from the last 60 sessions
  sigmaH: number; // over the horizon
  pUp: number;
  pDip: number;
  median: number;
  low: number; // one standard deviation below the centre
  high: number; // one above
  dipLevel: number; // 5% below today
  ma50: number | null;
  ma200: number | null;
  high250: number;
  low20: number;
  high20: number;
};

// Inverse normal CDF (Acklam's rational approximation, relative error 1e-9).
export function probit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  if (q < pl) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > ph) {
    const t = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  const t = q - 0.5, r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function projectLevels(bars: EodBar[], horizon: number, pUp: number, pDip: number, dipPct = 5): Projection | null {
  const c = bars.map((b) => b.close);
  const i = c.length - 1;
  if (i < 250) return null;
  const level = c[i];
  const n = 60;
  const rets: number[] = [];
  for (let k = i - n + 1; k <= i; k++) rets.push(Math.log(c[k] / c[k - 1]));
  const m = rets.reduce((s, v) => s + v, 0) / n;
  const sigmaDaily = Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / n);
  const sigmaH = sigmaDaily * Math.sqrt(horizon);
  // The model's tilt is capped at half a standard deviation either way: its
  // record is modest, and a range should not pretend otherwise.
  const z = Math.max(-0.5, Math.min(0.5, probit(Math.min(0.9, Math.max(0.1, pUp)))));
  const mu = z * sigmaH;
  const sma = (k: number) => (i + 1 >= k ? c.slice(i - k + 1).reduce((s, v) => s + v, 0) / k : null);
  let high250 = 0;
  for (let k = i - 249; k <= i; k++) if (c[k] > high250) high250 = c[k];
  let low20 = Infinity, high20 = 0;
  for (let k = i - 19; k <= i; k++) {
    if (c[k] < low20) low20 = c[k];
    if (c[k] > high20) high20 = c[k];
  }
  return {
    horizon,
    level,
    sigmaDaily,
    sigmaH,
    pUp,
    pDip,
    median: level * Math.exp(mu),
    low: level * Math.exp(mu - sigmaH),
    high: level * Math.exp(mu + sigmaH),
    dipLevel: level * (1 - dipPct / 100),
    ma50: sma(50),
    ma200: sma(200),
    high250,
    low20,
    high20,
  };
}

const fmt = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const odds = (p: number) => `${Math.round(p * 100)}%`;

// One line for the summary: odds, centre, range, the dip level.
export function projectionLine(p: Projection): string {
  return `Next ${p.horizon} sessions: ${odds(p.pUp)} odds higher; centre ${fmt(p.median)}, likely range ${fmt(p.low)} to ${fmt(p.high)}; ${odds(p.pDip)} odds of touching ${fmt(p.dipLevel)} first.`;
}

// The levels around the price, nearest first on each side.
export function levelsLine(p: Projection): string {
  const above: Array<[string, number]> = [];
  const below: Array<[string, number]> = [];
  const put = (name: string, v: number | null) => {
    if (v == null || !(v > 0)) return;
    // A level within a tenth of a percent of the price is the price; today's
    // close is often the 20-day low or high itself.
    if (Math.abs(v / p.level - 1) < 0.001) return;
    (v > p.level ? above : below).push([name, v]);
  };
  put("50d", p.ma50);
  put("200d", p.ma200);
  put("250d high", p.high250);
  put("20d low", p.low20);
  put("20d high", p.high20);
  above.sort((a, b) => a[1] - b[1]);
  below.sort((a, b) => b[1] - a[1]);
  const parts: string[] = [];
  if (above.length) parts.push(`above: ${above.map(([n, v]) => `${n} ${fmt(v)}`).join(", ")}`);
  if (below.length) parts.push(`below: ${below.map(([n, v]) => `${n} ${fmt(v)}`).join(", ")}`);
  return parts.length ? `Levels ${parts.join("; ")}.` : "";
}

// Bands the model would write down for a name: buy where a dip is likely to
// stall (one standard deviation to half a deviation under the centre), sell
// half to one deviation over it. Rounded to the tick a broker would take.
export type ModelBands = { buyLow: number; buyHigh: number; sellLow: number; sellHigh: number };

export function modelBands(p: Projection): ModelBands {
  const tick = p.level >= 1000 ? 5 : p.level >= 100 ? 1 : p.level >= 10 ? 0.25 : 0.05;
  const r = (v: number) => Math.round(v / tick) * tick;
  return {
    buyLow: r(p.median * Math.exp(-p.sigmaH)),
    buyHigh: r(p.median * Math.exp(-0.5 * p.sigmaH)),
    sellLow: r(p.median * Math.exp(0.5 * p.sigmaH)),
    sellHigh: r(p.median * Math.exp(p.sigmaH)),
  };
}

export function bandsLine(b: ModelBands): string {
  return `buy ${fmt(b.buyLow)} to ${fmt(b.buyHigh)}, sell ${fmt(b.sellLow)} to ${fmt(b.sellHigh)}`;
}
