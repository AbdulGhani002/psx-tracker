// The network's own view of a name's recent past: one small vector per
// session, the last SEQ_LEN of them read as a sequence (ml/psxnet.py).
//
//   ret    the day's log return over the name's 60-session volatility
//   rel    the same less the market's (equal-weight index) return that day
//   volZ   the day's volume against its 60-session average, in logs
//
// Scaled by the name's own volatility so a quiet utility and a wild small cap
// speak the same units, clipped so one bad print cannot dominate. The training
// export (scripts/net-export.ts) and the evening's inference (net-infer.ts)
// both come through here, so the network never sees a series built two ways.

import type { EodBar } from "@/lib/timeseries/psx-eod";

export const SEQ_LEN = 40;
export const SEQ_CHANNELS = 3;

const clip = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v);

// date -> [ret, rel, volZ], for every session the name has a bar after its
// first 61 (the volatility and the volume average need that much).
export function dailySeries(bars: EodBar[], index: EodBar[]): Map<string, [number, number, number]> {
  const ix = new Map(index.map((b) => [b.date, b.close]));
  const out = new Map<string, [number, number, number]>();
  const r: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i === 0 || !(b.close > 0) || !(bars[i - 1].close > 0)) {
      r.push(0);
      v.push(Math.max(0, b.volume));
      continue;
    }
    const ret = clip(Math.log(b.close / bars[i - 1].close), 0.25);
    r.push(ret);
    v.push(Math.max(0, b.volume));
    if (i < 61) continue;
    let m = 0;
    for (let k = i - 59; k <= i; k++) m += r[k];
    m /= 60;
    let s = 0;
    for (let k = i - 59; k <= i; k++) s += (r[k] - m) ** 2;
    const sigma = Math.max(0.004, Math.sqrt(s / 60));
    let av = 0;
    for (let k = i - 60; k < i; k++) av += v[k];
    av /= 60;
    const i0 = ix.get(bars[i - 1].date), i1 = ix.get(b.date);
    const mkt = i0 && i1 && i0 > 0 ? clip(Math.log(i1 / i0), 0.25) : 0;
    out.set(b.date, [clip(ret / sigma, 6), clip((ret - mkt) / sigma, 6), av > 0 && v[i] > 0 ? clip(Math.log(v[i] / av), 4) : -4]);
  }
  return out;
}

// The last SEQ_LEN sessions up to and including `date`, oldest first, as a
// flat [SEQ_LEN * (SEQ_CHANNELS + 1)] array: each step's three values and a
// 1 where the session exists (0 and padding before the name's history).
export function sequenceAt(series: Map<string, [number, number, number]>, calendar: string[], at: number): number[] {
  const out = new Array<number>(SEQ_LEN * (SEQ_CHANNELS + 1)).fill(0);
  for (let k = 0; k < SEQ_LEN; k++) {
    const ci = at - (SEQ_LEN - 1 - k);
    if (ci < 0) continue;
    const v = series.get(calendar[ci]);
    if (!v) continue;
    const o = k * (SEQ_CHANNELS + 1);
    out[o] = v[0];
    out[o + 1] = v[1];
    out[o + 2] = v[2];
    out[o + 3] = 1;
  }
  return out;
}
