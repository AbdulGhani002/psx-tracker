// What the whole market was doing on each date, as features every row of
// that date shares. Two kinds:
//
//   market   breadth and dispersion computed from the names themselves: how
//            many are above their averages, how spread out their recent
//            returns are, how the equal-weight market compares with the
//            cap-weighted index. These are the regime, and they are built
//            from the same bars as everything else so they reach back as far
//            as the price history does.
//   macro    the rupee, oil, and global risk appetite (see lib/timeseries/macro).
//
// Everything at date t uses closes up to and including t. Macro series are
// carried forward from their last print on or before t, never interpolated.

import type { EodBar } from "@/lib/timeseries/psx-eod";
import type { MacroKey } from "@/lib/timeseries/macro";

export const MARKET_CONTEXT_NAMES = ["brAbove50", "brAbove200", "brAdv20", "dispersion20", "ewRet20", "ewVol20", "ewGap60"] as const;
export const MACRO_CONTEXT_NAMES = ["pkrRet28", "pkrRet91", "pkrVol28", "oilRet28", "oilRet91", "spxRet28", "emRet28", "niftyRet28", "niftyRel91", "goldRet28", "us10yChg28", "dxyRet28"] as const;

const clip = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v);
const ln = Math.log;

type Acc = { n50: number; up50: number; n200: number; up200: number; n20: number; adv20: number; sumR20: number; sumR20sq: number; n1: number; sumR1: number };

export type MarketContext = Map<string, number[]>;

// Per date: breadth against the 50- and 200-day averages, the share of names
// up over 20 sessions, the dispersion of 20-session returns, the equal-weight
// market's 20-session return and 20-session volatility, and the equal-weight
// market's 60-session return minus the index's. A date with fewer than
// `minNames` names is left neutral (all zero).
export function marketContext(bars: Map<string, EodBar[]>, index: EodBar[], minNames = 10): MarketContext {
  const acc = new Map<string, Acc>();
  const get = (d: string) => {
    let a = acc.get(d);
    if (!a) acc.set(d, (a = { n50: 0, up50: 0, n200: 0, up200: 0, n20: 0, adv20: 0, sumR20: 0, sumR20sq: 0, n1: 0, sumR1: 0 }));
    return a;
  };
  for (const [, b] of bars) {
    const c = b.map((x) => x.close);
    let s50 = 0, s200 = 0;
    for (let i = 0; i < c.length; i++) {
      s50 += c[i]; if (i >= 50) s50 -= c[i - 50];
      s200 += c[i]; if (i >= 200) s200 -= c[i - 200];
      const a = get(b[i].date);
      if (i >= 1) { a.n1++; a.sumR1 += clip(ln(c[i] / c[i - 1]), 0.2); }
      if (i >= 20) { const r = clip(ln(c[i] / c[i - 20]), 0.6); a.n20++; a.sumR20 += r; a.sumR20sq += r * r; if (r > 0) a.adv20++; }
      if (i >= 49) { a.n50++; if (c[i] > s50 / 50) a.up50++; }
      if (i >= 199) { a.n200++; if (c[i] > s200 / 200) a.up200++; }
    }
  }
  const dates = [...acc.keys()].sort();
  // Equal-weight market: chain the mean daily log return.
  const ew: number[] = [];
  let level = 0;
  const ewLevel = new Map<string, number>();
  for (const d of dates) {
    const a = acc.get(d)!;
    const r = a.n1 >= minNames ? a.sumR1 / a.n1 : 0;
    level += r;
    ew.push(level);
    ewLevel.set(d, level);
  }
  const idxByDate = new Map(index.map((b) => [b.date, b.close]));
  const out: MarketContext = new Map();
  for (let k = 0; k < dates.length; k++) {
    const d = dates[k];
    const a = acc.get(d)!;
    if (a.n20 < minNames) { out.set(d, new Array(MARKET_CONTEXT_NAMES.length).fill(0)); continue; }
    const mean20 = a.sumR20 / a.n20;
    const disp = Math.sqrt(Math.max(0, a.sumR20sq / a.n20 - mean20 * mean20));
    // 20-session vol of the equal-weight market from its daily steps.
    let vol = 0;
    if (k >= 20) {
      const steps: number[] = [];
      for (let j = k - 19; j <= k; j++) steps.push(ew[j] - ew[j - 1]);
      const m = steps.reduce((s, v) => s + v, 0) / steps.length;
      vol = Math.sqrt(steps.reduce((s, v) => s + (v - m) ** 2, 0) / steps.length) * Math.sqrt(252);
    }
    const ewRet20 = k >= 20 ? ew[k] - ew[k - 20] : 0;
    let gap60 = 0;
    if (k >= 60) {
      const i0 = idxByDate.get(dates[k - 60]), i1 = idxByDate.get(d);
      if (i0 && i1) gap60 = ew[k] - ew[k - 60] - ln(i1 / i0);
    }
    out.set(d, [
      a.n50 >= minNames ? a.up50 / a.n50 - 0.5 : 0,
      a.n200 >= minNames ? a.up200 / a.n200 - 0.5 : 0,
      a.adv20 / a.n20 - 0.5,
      clip(disp, 0.5) * 2,
      clip(ewRet20, 0.4) * 4,
      clip(vol, 1),
      clip(gap60, 0.3) * 5,
    ]);
  }
  return out;
}

// Breadth today, for the report text.
export function breadthNow(bars: Map<string, EodBar[]>): { above50Pct: number; above200Pct: number; adv20Pct: number; names: number } {
  let n = 0, a50 = 0, a200 = 0, adv = 0;
  for (const [, b] of bars) {
    if (b.length < 200) continue;
    const c = b.map((x) => x.close);
    const i = c.length - 1;
    let s50 = 0, s200 = 0;
    for (let k = i - 49; k <= i; k++) s50 += c[k];
    for (let k = i - 199; k <= i; k++) s200 += c[k];
    n++;
    if (c[i] > s50 / 50) a50++;
    if (c[i] > s200 / 200) a200++;
    if (c[i] > c[i - 20]) adv++;
  }
  return { above50Pct: n ? (a50 / n) * 100 : 0, above200Pct: n ? (a200 / n) * 100 : 0, adv20Pct: n ? (adv / n) * 100 : 0, names: n };
}

// --- macro ------------------------------------------------------------------

function lastOnOrBefore(bars: EodBar[], date: string): number {
  let lo = 0, hi = bars.length; // first index with bars[i].date > date
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

const shift = (date: string, days: number) => new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10);

function retOver(bars: EodBar[], date: string, days: number): number {
  const i = lastOnOrBefore(bars, date);
  const j = lastOnOrBefore(bars, shift(date, days));
  if (i < 0 || j < 0 || i === j) return 0;
  return ln(bars[i].close / bars[j].close);
}

function volOver(bars: EodBar[], date: string, days: number): number {
  const i = lastOnOrBefore(bars, date);
  const j = lastOnOrBefore(bars, shift(date, days));
  if (i < 0 || j < 0 || i - j < 5) return 0;
  const steps: number[] = [];
  for (let k = j + 1; k <= i; k++) steps.push(ln(bars[k].close / bars[k - 1].close));
  const m = steps.reduce((s, v) => s + v, 0) / steps.length;
  return Math.sqrt(steps.reduce((s, v) => s + (v - m) ** 2, 0) / steps.length) * Math.sqrt(252);
}

// The change in a level (not a price) over a calendar window: the yield.
function chgOver(bars: EodBar[], date: string, days: number): number {
  const i = lastOnOrBefore(bars, date);
  const j = lastOnOrBefore(bars, shift(date, days));
  if (i < 0 || j < 0 || i === j) return 0;
  return bars[i].close - bars[j].close;
}

export function macroContext(macro: Map<MacroKey, EodBar[]>, dates: string[]): Map<string, number[]> {
  const pkr = macro.get("usdpkr") ?? [], oil = macro.get("oil") ?? [], spx = macro.get("spx") ?? [], em = macro.get("em") ?? [];
  const nifty = macro.get("nifty") ?? [], gold = macro.get("gold") ?? [], us10y = macro.get("us10y") ?? [], dxy = macro.get("dxy") ?? [];
  const out = new Map<string, number[]>();
  for (const d of dates) {
    out.set(d, [
      clip(retOver(pkr, d, 28), 0.1) * 20,
      clip(retOver(pkr, d, 91), 0.2) * 10,
      clip(volOver(pkr, d, 28), 0.3) * 5,
      clip(retOver(oil, d, 28), 0.4) * 4,
      clip(retOver(oil, d, 91), 0.6) * 2.5,
      clip(retOver(spx, d, 28), 0.2) * 8,
      clip(retOver(em, d, 28), 0.25) * 6,
      clip(retOver(nifty, d, 28), 0.25) * 6,
      // India against the emerging-market basket: where regional money is going.
      clip(retOver(nifty, d, 91) - retOver(em, d, 91), 0.3) * 4,
      clip(retOver(gold, d, 28), 0.2) * 8,
      // ^TNX is the yield times ten: a move of 10 is one percentage point.
      clip(chgOver(us10y, d, 28) / 10, 1) * 1.5,
      clip(retOver(dxy, d, 28), 0.1) * 15,
    ]);
  }
  return out;
}

// Market and macro side by side, in the order the feature names promise.
export function mergeContext(market: MarketContext | null, macro: Map<string, number[]> | null, dates: string[]): { context: Map<string, number[]>; names: string[] } | null {
  if (!market && !macro) return null;
  const names = [...(market ? MARKET_CONTEXT_NAMES : []), ...(macro ? MACRO_CONTEXT_NAMES : [])];
  const context = new Map<string, number[]>();
  for (const d of dates) {
    const m = market ? market.get(d) ?? new Array(MARKET_CONTEXT_NAMES.length).fill(0) : [];
    const x = macro ? macro.get(d) ?? new Array(MACRO_CONTEXT_NAMES.length).fill(0) : [];
    context.set(d, [...m, ...x]);
  }
  return { context, names };
}
