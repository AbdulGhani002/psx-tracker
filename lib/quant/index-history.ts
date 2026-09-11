// The KSE-100 back to 1997: Yahoo's ^KSE series, which stops in September
// 2021, spliced with the exchange's own five-year feed. The join is checked
// on the sessions both carry, and refused if they disagree by more than half
// a percent. Only the training run reads this; the report gets the table
// built from it inside the model document.

import { fetchYahooDaily } from "@/lib/timeseries/macro";
import { fetchEodBars, type EodBar } from "@/lib/timeseries/psx-eod";
import type { BarsCache } from "./universe";
import type { IndexBar } from "./outlook";

export const LONG_INDEX_KEY = "IDX:^KSE";

export async function loadLongIndex(cache: BarsCache | null, recent?: EodBar[]): Promise<{ bars: IndexBar[]; joinedAt: string; maxJoinDiffPct: number } | null> {
  let yahoo = cache ? await cache.get(LONG_INDEX_KEY).catch(() => null) : null;
  if (!yahoo || yahoo.length === 0) {
    yahoo = await fetchYahooDaily("^KSE", 1997).catch(() => []);
    if (yahoo.length > 0 && cache) await cache.put(LONG_INDEX_KEY, yahoo).catch(() => {});
  }
  const eod = recent && recent.length > 0 ? recent : await fetchEodBars("KSE100").catch(() => [] as EodBar[]);
  if (!yahoo || yahoo.length < 1000 || eod.length < 250) return null;
  const cut = eod[0].date;
  const byDate = new Map(yahoo.map((b) => [b.date, b.close]));
  let maxDiff = 0;
  for (const b of eod) {
    const y = byDate.get(b.date);
    if (y) maxDiff = Math.max(maxDiff, Math.abs(b.close / y - 1) * 100);
  }
  if (maxDiff > 0.5) return null;
  const bars: IndexBar[] = [...yahoo.filter((b) => b.date < cut).map((b) => ({ date: b.date, close: b.close })), ...eod.map((b) => ({ date: b.date, close: b.close }))];
  return { bars, joinedAt: cut, maxJoinDiffPct: maxDiff };
}
