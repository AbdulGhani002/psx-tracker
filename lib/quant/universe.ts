// Which names the network learns from, and their bars.
//
// The KSE-100 membership comes from the PSX market-watch page, the same feed
// the rest of the app uses for index membership. If that page is down, the
// list below (the membership on 9 September 2026) stands in, because a
// training run that silently shrank to ten names would be worse than one that
// used a slightly stale hundred.

import { fetchMarketWatch, isInIndex } from "@/lib/prices/marketwatch";
import { fetchEodBars, type EodBar } from "@/lib/timeseries/psx-eod";

export const KSE100_FALLBACK: string[] = [
  "ABOT", "AHCL", "AIRLINK", "AKBL", "APL", "ATLH", "ATRL", "BAFL", "BNWM", "BOP", "CHCC", "CNERGY", "COLG", "CPHL", "DCR",
  "DGKC", "EFERT", "ENGROH", "FABL", "FATIMA", "FCCL", "FFC", "FFL", "FHAM", "GADT", "GAL", "GHGL", "GHNI", "HBL", "HCAR",
  "HGFA", "HINOON", "HMB", "HUBC", "HUMNL", "IBFL", "ILP", "INDU", "INIL", "ISL", "JDWS", "JVDC", "KAPCO", "KEL", "KOHC",
  "KTML", "LCI", "LOTCHEM", "LUCK", "MARI", "MCB", "MEBL", "MEHT", "MLCF", "MTL", "MUREB", "NATF", "NBP", "NESTLE", "NML",
  "NPL", "OGDC", "PABC", "PAEL", "PAKT", "PGLC", "PIBTL", "PIOC", "PKGS", "POL", "POWER", "PPL", "PSEL", "PSO", "PSX", "PTC",
  "SAZEW", "SEARL", "SHFA", "SNGP", "SRVI", "SSGC", "SSOM", "SYS", "TGL", "THALL", "TPLRF1", "TRG", "UBL", "YOUW",
];

export const TRAIN_INDICES = ["KSE100", "KMI30", "KSE30"];

export async function kse100Symbols(): Promise<{ symbols: string[]; source: "marketwatch" | "fallback" }> {
  try {
    const m = await fetchMarketWatch();
    if (m) {
      const symbols = [...m.values()].filter((r) => isInIndex(r, "KSE100")).map((r) => r.symbol).sort();
      if (symbols.length >= 60) return { symbols, source: "marketwatch" };
    }
  } catch {
    /* fall through */
  }
  return { symbols: [...KSE100_FALLBACK], source: "fallback" };
}

// Bars are fetched once and kept by whoever is running: the training job on
// disk, the server in the feed store. Six hours is long enough that the
// evening report and the weekly training never fetch the same day twice, and
// short enough that a morning run never trains on yesterday's close.
export type BarsCache = {
  get(symbol: string): Promise<EodBar[] | null>; // fresh only
  put(symbol: string, bars: EodBar[]): Promise<void>;
  getStale?(symbol: string): Promise<EodBar[] | null>; // whatever we last had, any age
};

// Fetches from the server go one at a time with a pause between them: a
// burst of ninety requests in a few seconds got the server's address dropped
// by the portal on 10 September 2026. Cache hits cost nothing and skip the pause.
export async function loadBars(symbols: string[], cache: BarsCache | null = null, concurrency = 1, pauseMs = 400): Promise<Map<string, EodBar[]>> {
  const out = new Map<string, EodBar[]>();
  const queue = [...new Set(symbols)];
  // After three straight misses with nothing fetched, the portal is taken to
  // be refusing this address and the rest come from the cache alone.
  let misses = 0, fetched = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const s = queue.shift();
      if (!s) return;
      try {
        const hit = cache ? await cache.get(s) : null;
        if (hit && hit.length > 0) {
          out.set(s, hit);
          continue;
        }
        const blocked = misses >= 3 && fetched === 0;
        if (!blocked && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
        const bars = blocked ? ([] as EodBar[]) : await fetchEodBars(s).catch(() => [] as EodBar[]);
        if (bars.length > 0) {
          fetched++;
          misses = 0;
          out.set(s, bars);
          if (cache) await cache.put(s, bars).catch(() => {});
          continue;
        }
        misses++;
        // The feed is down or throttled: yesterday's series beats no series.
        // A report built on it says so through its dates; a report with no
        // charts says nothing.
        const stale = cache?.getStale ? await cache.getStale(s).catch(() => null) : null;
        if (stale && stale.length > 0) out.set(s, stale);
      } catch {
        /* a name that fails to load is left out of the panel */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
