// The handful of outside series that move the PSX: the rupee, oil, and
// global risk appetite. Daily closes from Yahoo Finance's chart endpoint,
// which is the one free source with twenty years of each.
//
//   USD/PKR   a weakening rupee is the single most reliable PSX headwind:
//             it forces the policy rate up and foreign money out
//   crude     Pakistan imports its energy, so oil is the current account;
//             it also drives the E&P names that are a fifth of the index
//   S&P 500   global risk on or off
//   EEM       the emerging-market basket the foreign PSX money sits in
//
// The series come back shaped like price bars so the same caches that hold
// stock bars can hold them.

import type { EodBar } from "./psx-eod";

export const MACRO_SERIES = [
  { key: "usdpkr", symbol: "PKR=X", label: "USD/PKR" },
  { key: "oil", symbol: "CL=F", label: "WTI crude" },
  { key: "spx", symbol: "^GSPC", label: "S&P 500" },
  { key: "em", symbol: "EEM", label: "EM equities" },
] as const;

export type MacroKey = (typeof MACRO_SERIES)[number]["key"];

export async function fetchYahooDaily(symbol: string, fromYear = 2001): Promise<EodBar[]> {
  const period1 = Math.floor(Date.UTC(fromYear, 0, 1) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; psx-tracker/0.1)", accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return [];
  const body: any = await res.json().catch(() => null);
  const r = body?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const closes: Array<number | null> = r?.indicators?.quote?.[0]?.close ?? [];
  const out: EodBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    if (out.length && out[out.length - 1].date === date) out[out.length - 1].close = c;
    else out.push({ date, close: c, volume: 0, vwap: c });
  }
  return despike(out);
}

// Yahoo's FX history carries the odd one-day tick that is off by a factor.
// A point that jumps more than 15% from both neighbours and comes straight
// back is a bad tick, not a devaluation, and is dropped.
export function despike(bars: EodBar[], limit = 0.15): EodBar[] {
  if (bars.length < 3) return bars;
  const keep: EodBar[] = [bars[0]];
  for (let i = 1; i < bars.length - 1; i++) {
    const a = Math.log(bars[i].close / bars[i - 1].close);
    const b = Math.log(bars[i + 1].close / bars[i].close);
    if (Math.abs(a) > limit && Math.abs(b) > limit && Math.sign(a) !== Math.sign(b)) continue;
    keep.push(bars[i]);
  }
  keep.push(bars[bars.length - 1]);
  return keep;
}

export type MacroCache = {
  get(key: string): Promise<EodBar[] | null>;
  put(key: string, bars: EodBar[]): Promise<void>;
};

// Every series, or null if any of them failed: a model must never be trained
// on a context where one input silently went to zero.
export async function loadMacro(cache: MacroCache | null = null): Promise<Map<MacroKey, EodBar[]> | null> {
  const out = new Map<MacroKey, EodBar[]>();
  for (const s of MACRO_SERIES) {
    const cacheKey = `MACRO:${s.key}`;
    let bars = cache ? await cache.get(cacheKey).catch(() => null) : null;
    if (!bars || bars.length === 0) {
      bars = await fetchYahooDaily(s.symbol).catch(() => []);
      if (bars.length > 0 && cache) await cache.put(cacheKey, bars).catch(() => {});
    }
    if (!bars || bars.length < 500) return null;
    out.set(s.key, bars);
  }
  return out;
}

// Latest value and the change over a calendar window, for the report text.
export function macroRead(bars: EodBar[], days: number): { last: number; date: string; changePct: number } | null {
  if (bars.length === 0) return null;
  const last = bars[bars.length - 1];
  const cutoff = new Date(Date.parse(last.date) - days * 86400000).toISOString().slice(0, 10);
  let ref = bars[0];
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= cutoff) { ref = bars[i]; break; }
  return { last: last.close, date: last.date, changePct: (last.close / ref.close - 1) * 100 };
}
