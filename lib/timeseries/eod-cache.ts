// Price series for the pages, cache first.
//
// The exchange's portal drops the server's address after bursts of requests
// (see lib/quant/universe.ts), so the series the charts, movers and ticker
// need come from the bars the laptop pushes into the feed store every
// weekday, and only fall back to the portal one request at a time. The last
// series ever seen stands in when both fail: a chart a day stale beats no
// chart.

import { loadBars } from "@/lib/quant/universe";
import { mongoBarsCache } from "@/lib/quant/store";
import type { EodBar, EodPoint } from "./psx-eod";

const MAX_AGE_HOURS = 30;

export async function eodBarsCached(symbols: string[]): Promise<Map<string, EodBar[]>> {
  return loadBars(symbols, mongoBarsCache(MAX_AGE_HOURS));
}

export async function eodSeriesCached(symbol: string): Promise<EodPoint[]> {
  const m = await eodBarsCached([symbol]);
  return (m.get(symbol) ?? []).map((b) => ({ date: b.date, close: b.close }));
}

export async function manyEodCached(symbols: string[]): Promise<Map<string, EodPoint[]>> {
  const m = await eodBarsCached(symbols);
  const out = new Map<string, EodPoint[]>();
  for (const [s, bars] of m) out.set(s, bars.map((b) => ({ date: b.date, close: b.close })));
  return out;
}

export type IndexTicker = { symbol: string; label: string; level: number; change: number; changePct: number; date: string };

// The market line for the top bar: the KSE-100's last close against the one
// before, from the same cache.
export async function indexTickers(): Promise<IndexTicker[]> {
  const wanted: Array<[string, string]> = [["KSE100", "KSE-100"], ["KMI30", "KMI-30"]];
  const m = await eodBarsCached(wanted.map((w) => w[0]));
  const out: IndexTicker[] = [];
  for (const [symbol, label] of wanted) {
    const b = m.get(symbol);
    if (!b || b.length < 2) continue;
    const last = b[b.length - 1], prev = b[b.length - 2];
    out.push({ symbol, label, level: last.close, change: last.close - prev.close, changePct: (last.close / prev.close - 1) * 100, date: last.date });
  }
  return out;
}
