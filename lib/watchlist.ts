import "server-only";
import { cache } from "react";
import symbols from "@/lib/psx-symbols.json";
import { connectDb } from "@/lib/db";
import { WatchlistModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { sectorKey, displaySector } from "@/lib/calculations/sector-weights";

// The watchlist: shares and sectors ticked on its page, saved as ticked.
// Sectors are kept by their normalised key (sectorKey), shares by symbol.

export type Listing = { symbol: string; name: string; sector: string; sectorName: string };
export type Watch = { symbols: string[]; sectors: string[] };

type Row = { symbol: string; name: string; sector: string; etf?: boolean };

const RIGHTS = /\((r|right)\)|\bright\b/i;

// Every share the exchange lists, by sector: ETFs and rights lines left out,
// a blank sector as "Other".
export const listings = cache((): Listing[] =>
  (symbols as Row[])
    .filter((r) => !r.etf && !RIGHTS.test(r.name))
    .map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector ? sectorKey(r.sector) : "OTHER", sectorName: r.sector ? displaySector(r.sector) : "Other" }))
);

async function _getWatchlist(): Promise<Watch> {
  const uid = await getCurrentUserId();
  if (!uid) return { symbols: [], sectors: [] };
  await connectDb();
  const doc: any = await WatchlistModel.findOne({ userId: uid }).lean();
  return { symbols: [...(doc?.symbols ?? [])], sectors: [...(doc?.sectors ?? [])] };
}
export const getWatchlist = cache(_getWatchlist);

// The ticked shares and every share of a ticked sector.
export function watchedSymbols(w: Watch): string[] {
  const sectors = new Set(w.sectors);
  return [...new Set([...w.symbols, ...listings().filter((l) => sectors.has(l.sector)).map((l) => l.symbol)])];
}
