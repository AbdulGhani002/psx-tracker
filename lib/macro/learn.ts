// The strategy's learning, pure so scripts/test-strategy-picks.ts runs it.
//   The return a share can be expected to make against the market over the
//   next three months, from the model's rank: the network's tested record
//   (each tenth of its ranking on the years it never saw), moved toward what
//   the calls stored each evening actually did as they come in.
//   Whether a share's P/E against its usual has told anything about its next
//   three months: measured again each day, quarter by quarter, and counted
//   only once it holds (|t| of 2 or more over 8 quarters or more), and then
//   only so far.
//   A share's dividend yield over the year to any date, from the exchange's
//   record of its cash dividends.

import type { Calibration } from "./artifact";

// Trading costs there and back (brokerage, the taxes on a trade, the spread):
// an expected edge under this is not worth a trade.
export const ROUND_TRIP = 0.01;

// What stored calls did, by tenth of the rank they were made at.
export function liveCalibration(rows: Array<{ pctile: number; rel3: number }>): Calibration {
  const acc = Array.from({ length: 10 }, () => ({ sum: 0, hit: 0, n: 0 }));
  for (const r of rows) {
    if (!Number.isFinite(r.pctile) || !Number.isFinite(r.rel3)) continue;
    const d = Math.min(9, Math.max(0, Math.floor(r.pctile * 10)));
    acc[d].sum += r.rel3;
    acc[d].hit += r.rel3 > 0 ? 1 : 0;
    acc[d].n++;
  }
  return acc.map((a, d) => ({ lo: d / 10, hi: (d + 1) / 10, rel3: a.n ? a.sum / a.n : 0, hit: a.n ? a.hit / a.n : 0, n: a.n }));
}

// Each tenth of the record moved toward the live outcomes in proportion to
// how many there are: `weight` live outcomes count as much as the record.
export function blendCalibration(base: Calibration, live: Calibration | null, weight = 1000): Calibration {
  if (!live) return base;
  return base.map((b, d) => {
    const l = live[d];
    if (!l || l.n === 0) return b;
    const w = l.n / (l.n + weight);
    return { ...b, rel3: b.rel3 * (1 - w) + l.rel3 * w, hit: b.hit * (1 - w) + l.hit * w, n: b.n + l.n };
  });
}

// The expected return at a rank, straight between the middles of the tenths.
export function edgeAt(cal: Calibration, pctile: number): number {
  if (cal.length === 0) return 0;
  const mids = cal.map((c) => (c.lo + c.hi) / 2);
  const p = Math.min(1, Math.max(0, pctile));
  if (p <= mids[0]) return cal[0].rel3;
  for (let k = 1; k < cal.length; k++) {
    if (p <= mids[k]) {
      const f = (p - mids[k - 1]) / (mids[k] - mids[k - 1]);
      return cal[k - 1].rel3 + f * (cal[k].rel3 - cal[k - 1].rel3);
    }
  }
  return cal[cal.length - 1].rel3;
}

export type ValueEffect = { beta: number; t: number; n: number; quarters: number; from: string | null; to: string | null; holds: boolean };

// The slope of the next three months' return against the market on the log
// of P/E over its usual, measured within each quarter and then averaged over
// the quarters, with the t of that average (shares in one quarter move
// together, so the quarters are the independent readings, not the shares).
// It holds at |t| of 2 or more over 8 quarters or more and 200 readings.
export function valueEffect(obs: Array<{ date: string; value: number; rel3: number }>): ValueEffect {
  const o = obs.filter((x) => Number.isFinite(x.value) && Number.isFinite(x.rel3));
  const byDate = new Map<string, typeof o>();
  for (const x of o) (byDate.get(x.date) ?? byDate.set(x.date, []).get(x.date)!).push(x);
  const dates = [...byDate.keys()].sort();
  const base = { n: o.length, quarters: dates.length, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
  const slopes: number[] = [];
  for (const d of dates) {
    const q = byDate.get(d)!;
    if (q.length < 10) continue;
    const mx = q.reduce((s, x) => s + x.value, 0) / q.length, my = q.reduce((s, x) => s + x.rel3, 0) / q.length;
    let sxy = 0, sxx = 0;
    for (const x of q) {
      sxy += (x.value - mx) * (x.rel3 - my);
      sxx += (x.value - mx) ** 2;
    }
    if (sxx > 0) slopes.push(sxy / sxx);
  }
  if (o.length < 30 || slopes.length < 2) return { beta: 0, t: 0, holds: false, ...base, quarters: slopes.length };
  const beta = slopes.reduce((s, v) => s + v, 0) / slopes.length;
  const sd = Math.sqrt(slopes.reduce((s, v) => s + (v - beta) ** 2, 0) / (slopes.length - 1));
  const t = sd > 0 ? beta / (sd / Math.sqrt(slopes.length)) : 0;
  return { beta, t, holds: Math.abs(t) >= 2 && slopes.length >= 8 && o.length >= 200, ...base, quarters: slopes.length };
}

// How far P/E against its usual can move the edge: as if it were at most
// two-thirds over or two-fifths under (a share whose earnings collapsed does
// not take the edge with it).
const VALUE_CAP = 0.5;

// A share's expected return against the market over the next three months:
// its rank's, plus what its P/E against its usual adds where that holds.
export function expectedEdge(cal: Calibration, pctile: number | null, value: number | null, effect: ValueEffect | null): number | null {
  if (pctile == null) return null;
  const v = value != null && value > 0 && effect?.holds ? effect.beta * Math.max(-VALUE_CAP, Math.min(VALUE_CAP, Math.log(value))) : 0;
  return edgeAt(cal, pctile) + v;
}

// Cash paid over the year to a date, as yields at the prices of the
// ex-dates.
export function yieldOn(divs: Array<{ date: string; yieldPct: number }>, date: string): number {
  const from = new Date(Date.parse(date + "T00:00:00Z") - 365 * 86400000).toISOString().slice(0, 10);
  return divs.filter((d) => d.date > from && d.date <= date).reduce((s, d) => s + d.yieldPct, 0);
}
