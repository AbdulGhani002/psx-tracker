import { cache } from "react";
import symbols from "@/lib/psx-symbols.json";
import { sectorKey, displaySector } from "@/lib/calculations/sector-weights";

// Every share the exchange lists, with its name and sector: ETFs and rights
// lines left out, a blank sector as "Other".

export type Listing = { symbol: string; name: string; sector: string; sectorName: string };

type Row = { symbol: string; name: string; sector: string; etf?: boolean };

const RIGHTS = /\((r|right)\)|\bright\b/i;

export const listings = cache((): Listing[] =>
  (symbols as Row[])
    .filter((r) => !r.etf && !RIGHTS.test(r.name))
    .map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector ? sectorKey(r.sector) : "OTHER", sectorName: r.sector ? displaySector(r.sector) : "Other" }))
);
