// The exchange's own 24-year archive, as a training set.
//
// scripts/psx-history.ts pulls one closing sheet per trading day from the
// PSX portal and assembles per-symbol files. This module turns that folder
// into what the model needs: bars per name, a universe that changes each
// year (the `top` names by median traded value over the PREVIOUS year, so a
// name enters only on what was known before it entered, and names later
// delisted stay in for the years they were liquid), and an equal-weight index
// of the current members, because no free feed carries the KSE-100 back to
// 2002. Both the long test and the weekly training run come through here, so
// the model that is shipped is the model that was tested.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import { buildPanel, type Panel } from "./panel";
import { marketContext, mergeContext, type MarketContext } from "./context";
import { FEATURE_NAMES, RANK_FEATURE_NAMES } from "./features";

const iso = (n: number) => String(n).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");

// The sheets carry raw prices, so a 10% bonus issue reads as a 9% fall and a
// 1:10 split as a 90% crash; over twenty-four years that turned an
// equal-weight index of the most traded names into a losing one. The sheets
// also carry LDCP, the exchange's own previous close, which it adjusts on
// ex-dates. Where LDCP differs from the raw previous close by more than half
// a percent, that ratio is the adjustment, and every earlier price is scaled
// by it (volume the other way). Cash dividends are not adjusted here, and
// need not be: the targets are twenty-session returns, not total returns.
export type RawRow = [d: number, o: number, h: number, l: number, c: number, v: number, ldcp?: number];

export function adjustedSeries(raw: RawRow[], threshold = 0.005): EodBar[] {
  const n = raw.length;
  const mult = new Float64Array(n).fill(1);
  // Walk backwards: the multiplier for day i is the product of every
  // adjustment that happened AFTER day i.
  let m = 1;
  for (let i = n - 1; i >= 0; i--) {
    mult[i] = m;
    const ldcp = raw[i][6] ?? 0;
    const prev = i > 0 ? raw[i - 1][4] : 0;
    if (ldcp > 0 && prev > 0) {
      const f = ldcp / prev;
      if (Math.abs(f - 1) > threshold && f > 0.005 && f < 200) m *= f;
    }
  }
  const bars: EodBar[] = [];
  for (let i = 0; i < n; i++) {
    const [d, , h, l, c, v] = raw[i];
    if (!(c > 0)) continue;
    const k = mult[i];
    // Close against the day's typical price stands in for close against
    // VWAP, which this archive does not carry.
    const typical = h > 0 && l > 0 ? ((h + l + c) / 3) * k : c * k;
    bars.push({ date: iso(d), close: c * k, volume: v > 0 ? v / k : 0, vwap: typical });
  }
  return bars;
}

export function loadArchive(dir: string, only: Set<string> | null = null): Map<string, EodBar[]> {
  const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { index: Array<{ symbol: string; bars: number }> };
  const out = new Map<string, EodBar[]>();
  for (const e of idx.index) {
    if (only && !only.has(e.symbol)) continue;
    const f = join(dir, "symbols", e.symbol + ".json");
    if (!existsSync(f)) continue;
    const raw = JSON.parse(readFileSync(f, "utf8")) as RawRow[];
    const bars = adjustedSeries(raw);
    if (bars.length >= 250) out.set(e.symbol, bars);
  }
  return out;
}

// Today's close from the live feed, appended to an adjusted archive series
// when the feed's previous close matches the archive's last close (so no
// unadjusted corporate action slips in). Returns how many days were added.
export function appendLive(archive: EodBar[], live: EodBar[], tolerance = 0.005): number {
  if (archive.length === 0 || live.length === 0) return 0;
  const last = archive[archive.length - 1];
  let added = 0;
  for (let i = 0; i < live.length; i++) {
    if (live[i].date <= last.date) continue;
    const prev = i > 0 ? live[i - 1] : null;
    const anchor = archive[archive.length - 1];
    if (!prev || prev.date !== anchor.date || Math.abs(prev.close / anchor.close - 1) > tolerance) break;
    archive.push({ ...live[i] });
    added++;
  }
  return added;
}

// Per calendar year, the `top` names by median traded value in the previous year.
export function membership(bars: Map<string, EodBar[]>, top: number): Map<number, Set<string>> {
  const byYear = new Map<number, Map<string, number[]>>();
  for (const [s, b] of bars) {
    for (const bar of b) {
      const y = Number(bar.date.slice(0, 4));
      let m = byYear.get(y);
      if (!m) byYear.set(y, (m = new Map()));
      let arr = m.get(s);
      if (!arr) m.set(s, (arr = []));
      arr.push(bar.close * bar.volume);
    }
  }
  const out = new Map<number, Set<string>>();
  for (const [y, m] of byYear) {
    const ranked = [...m]
      .filter(([, v]) => v.length >= 200)
      .map(([s, v]) => {
        const sorted = [...v].sort((a, b) => a - b);
        return { s, med: sorted[Math.floor(sorted.length / 2)] };
      })
      .filter((r) => r.med > 0)
      .sort((a, b) => b.med - a.med)
      .slice(0, top)
      .map((r) => r.s);
    out.set(y + 1, new Set(ranked));
  }
  return out;
}

// Equal-weight index chained from mean daily log returns. With `members` it
// follows the year's universe; without, every name given.
export function equalWeightIndex(bars: Map<string, EodBar[]>, members: Map<number, Set<string>> | null = null, minNames = 10): EodBar[] {
  const acc = new Map<string, { s: number; n: number }>();
  for (const [sym, b] of bars) {
    for (let i = 1; i < b.length; i++) {
      if (members && !members.get(Number(b[i].date.slice(0, 4)))?.has(sym)) continue;
      const r = Math.max(-0.3, Math.min(0.3, Math.log(b[i].close / b[i - 1].close)));
      const a = acc.get(b[i].date);
      if (a) {
        a.s += r;
        a.n++;
      } else acc.set(b[i].date, { s: r, n: 1 });
    }
  }
  const dates = [...acc.keys()].sort();
  const out: EodBar[] = [];
  let level = Math.log(100);
  for (const d of dates) {
    const a = acc.get(d)!;
    if (a.n < minNames) continue;
    level += a.s / a.n;
    out.push({ date: d, close: Math.exp(level), volume: 0, vwap: Math.exp(level) });
  }
  return out;
}

export type ArchivePanel = {
  panel: Panel;
  index: EodBar[]; // the equal-weight index of the members
  bars: Map<string, EodBar[]>; // every archive name
  market: MarketContext;
  context: Map<string, number[]>;
  contextNames: string[];
  featureNames: string[];
  members: Map<number, Set<string>>;
  universe: string[]; // names ever members
  years: [number, number];
};

export function buildArchivePanel(dir: string, horizon: number, top = 120, ranks = false, macro: Map<string, number[]> | null = null): ArchivePanel {
  const bars = loadArchive(dir);
  const members = membership(bars, top);
  const memberSymbols = new Set<string>();
  for (const [, s] of members) for (const x of s) memberSymbols.add(x);
  const years = [...members.keys()].sort();
  const index = equalWeightIndex(bars, members);
  const dates = index.map((b) => b.date);
  const market = marketContext(bars, index);
  const merged = mergeContext(market, macro, dates)!;
  const memberBars = new Map([...bars].filter(([s]) => memberSymbols.has(s)));
  const include = (symbol: string, date: string) => members.get(Number(date.slice(0, 4)))?.has(symbol) ?? false;
  const panel = buildPanel(memberBars, index, horizon, { context: merged.context, include, minRows: 60, ranks });
  return {
    panel,
    index,
    bars,
    market,
    context: merged.context,
    contextNames: merged.names,
    featureNames: [...FEATURE_NAMES, ...merged.names, ...(ranks ? RANK_FEATURE_NAMES : [])],
    members,
    universe: [...memberSymbols].sort(),
    years: [years[0], years[years.length - 1]],
  };
}
