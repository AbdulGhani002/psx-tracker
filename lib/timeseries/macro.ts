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
//   Nifty 50  the neighbour: India's market, and its pull on regional money
//   gold      the local store of value when the rupee or equities wobble
//   US 10y    the world's risk-free rate; dollars leave frontier markets as it rises
//   DXY       the dollar itself, against the major currencies
//
// The series come back shaped like price bars so the same caches that hold
// stock bars can hold them.

import type { EodBar } from "./psx-eod";

export const MACRO_SERIES = [
  { key: "usdpkr", symbol: "PKR=X", label: "USD/PKR" },
  { key: "oil", symbol: "CL=F", label: "WTI crude" },
  { key: "spx", symbol: "^GSPC", label: "S&P 500" },
  { key: "em", symbol: "EEM", label: "EM equities" },
  { key: "nifty", symbol: "^NSEI", label: "Nifty 50" },
  { key: "gold", symbol: "GC=F", label: "Gold" },
  { key: "us10y", symbol: "^TNX", label: "US 10-year yield (x10)" },
  { key: "dxy", symbol: "DX-Y.NYB", label: "US dollar index" },
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

// Yahoo's daily USD/PKR closes sometimes interleave a second feed: in
// September 2026 most of them came from one about 3% off the market (268.5
// against 277, some outside their own day's range), while the hourly prices,
// two independent references and Yahoo's own quote all read 277. So the
// rupee is taken from the hourly prices where Yahoo keeps them (about two
// years): each Karachi day's median hour, which matched the references to
// half a percent from 2024 on. Before that come the daily closes, and a
// daily close inside the hourly window that stands more than 1.5% off its
// hourly-backed neighbours is dropped.
export function hourlyMedians(timestamps: number[], closes: Array<number | null>, tzOffsetHours = 5): Map<string, number> {
  const byDay = new Map<string, number[]>();
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const d = new Date((timestamps[i] + tzOffsetHours * 3600) * 1000).toISOString().slice(0, 10);
    const g = byDay.get(d);
    if (g) g.push(c);
    else byDay.set(d, [c]);
  }
  const out = new Map<string, number>();
  for (const [d, v] of byDay) {
    const s = [...v].sort((a, b) => a - b);
    out.set(d, s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  }
  return out;
}

export function mergeFx(daily: EodBar[], hourly: Map<string, number>, tolerance = 0.015): EodBar[] {
  const hDates = [...hourly.keys()].sort();
  const firstHourly = hDates[0] ?? "9999";
  const nearest = (d: string): number | null => {
    let lo = 0, hi = hDates.length - 1, at = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (hDates[m] <= d) { at = m; lo = m + 1; } else hi = m - 1;
    }
    const before = at >= 0 ? hourly.get(hDates[at])! : null;
    const after = at + 1 < hDates.length ? hourly.get(hDates[at + 1])! : null;
    return before != null && after != null ? (before + after) / 2 : before ?? after;
  };
  const out = new Map<string, number>();
  for (const b of daily) {
    if (!(b.close > 0)) continue;
    if (b.date >= firstHourly && !hourly.has(b.date)) {
      const ref = nearest(b.date);
      if (ref != null && Math.abs(b.close / ref - 1) > tolerance) continue;
    }
    out.set(b.date, b.close);
  }
  for (const [d, v] of hourly) out.set(d, v);
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, close]) => ({ date, close, volume: 0, vwap: close }));
}

export async function fetchYahooHourlyMedians(symbol: string): Promise<Map<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=730d&interval=1h`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; psx-tracker/0.1)", accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return new Map();
  const body: any = await res.json().catch(() => null);
  const r = body?.chart?.result?.[0];
  return hourlyMedians(r?.timestamp ?? [], r?.indicators?.quote?.[0]?.close ?? []);
}

export async function fetchUsdPkrDaily(): Promise<EodBar[]> {
  const [daily, hourly] = await Promise.all([fetchYahooDaily("PKR=X").catch(() => [] as EodBar[]), fetchYahooHourlyMedians("PKR=X").catch(() => new Map<string, number>())]);
  return mergeFx(daily, hourly);
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
      bars = await (s.key === "usdpkr" ? fetchUsdPkrDaily() : fetchYahooDaily(s.symbol)).catch(() => []);
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
