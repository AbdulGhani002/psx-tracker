import "server-only";
import { cache } from "react";
import symbols from "@/lib/psx-symbols.json";
import { connectDb } from "@/lib/db";
import { WatchlistModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { sectorKey, displaySector } from "@/lib/calculations/sector-weights";

// The watchlist: the sectors ticked on its page, kept by their normalised key
// (sectorKey). Every share of a ticked sector is watched.

export type Listing = { symbol: string; name: string; sector: string; sectorName: string };
export type Watch = { sectors: string[] };

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
  if (!uid) return { sectors: [] };
  await connectDb();
  const doc: any = await WatchlistModel.findOne({ userId: uid }).lean();
  return { sectors: [...(doc?.sectors ?? [])] };
}
export const getWatchlist = cache(_getWatchlist);

// Every share of a ticked sector.
export function watchedSymbols(w: Watch): string[] {
  const sectors = new Set(w.sectors);
  return listings().filter((l) => sectors.has(l.sector)).map((l) => l.symbol);
}

// The sectors for the page, A to Z with "Other" last: each with its shares (to
// find a sector by one of them) and the ones held.
export type SectorGroup = { key: string; name: string; shares: Array<[string, string]>; held: string[] };

export function sectorGroups(all: Listing[], held: Set<string>): SectorGroup[] {
  const by = new Map<string, SectorGroup>();
  for (const l of all) {
    const g = by.get(l.sector) ?? by.set(l.sector, { key: l.sector, name: l.sectorName, shares: [], held: [] }).get(l.sector)!;
    g.shares.push([l.symbol, l.name]);
    if (held.has(l.symbol)) g.held.push(l.symbol);
  }
  return [...by.values()].sort((a, b) => (a.key === "OTHER" ? 1 : b.key === "OTHER" ? -1 : a.name.localeCompare(b.name)));
}
