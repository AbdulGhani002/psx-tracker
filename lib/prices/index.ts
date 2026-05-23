import { connectDb } from "@/lib/db";
import { PriceSnapshotModel } from "@/lib/models";
import { StubFetcher } from "./stub";
import { PSXScraperFetcher } from "./scraper";
import { isMarketHoursNow, type CompanyInfo, type PriceFetcher, type PriceQuote } from "./types";

export type { PriceQuote, CompanyInfo } from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000;

let activeFetcher: PriceFetcher | null = null;

export function getFetcher(): PriceFetcher {
  if (activeFetcher) return activeFetcher;
  const strategy = process.env.PRICE_FETCHER_STRATEGY ?? "psx-scraper";
  activeFetcher = strategy === "stub" ? new StubFetcher() : new PSXScraperFetcher();
  return activeFetcher;
}

async function readLatestFromCache(symbol: string): Promise<PriceQuote | null> {
  const snap = await PriceSnapshotModel.findOne({ symbol: symbol.toUpperCase() })
    .sort({ timestamp: -1 })
    .lean();
  if (!snap) return null;
  return {
    symbol: snap.symbol,
    price: snap.price,
    timestamp: new Date(snap.timestamp),
    source: snap.source,
  };
}

function isFresh(snap: PriceQuote): boolean {
  return Date.now() - snap.timestamp.getTime() < CACHE_TTL_MS;
}

async function writeSnapshot(q: PriceQuote): Promise<void> {
  await PriceSnapshotModel.create({
    symbol: q.symbol,
    price: q.price,
    timestamp: q.timestamp,
    source: q.source,
    isMarketHours: isMarketHoursNow(q.timestamp),
  });
}

export async function getPrices(symbols: string[]): Promise<Map<string, number>> {
  await connectDb();
  const out = new Map<string, number>();
  const fetcher = getFetcher();
  const stale: string[] = [];

  for (const sym of symbols.map((s) => s.toUpperCase())) {
    const cached = await readLatestFromCache(sym);
    if (cached && isFresh(cached)) {
      out.set(sym, cached.price);
    } else {
      stale.push(sym);
    }
  }

  if (stale.length > 0) {
    const fresh = await fetcher.fetchBatch(stale);
    for (const [sym, quote] of fresh) {
      out.set(sym, quote.price);
      try { await writeSnapshot(quote); } catch { /* swallow */ }
    }
    for (const sym of stale) {
      if (!out.has(sym)) {
        const cached = await readLatestFromCache(sym);
        if (cached) out.set(sym, cached.price);
      }
    }
  }

  return out;
}

export async function refreshPrice(symbol: string): Promise<PriceQuote | null> {
  await connectDb();
  const q = await getFetcher().fetchPrice(symbol);
  if (q) {
    try { await writeSnapshot(q); } catch { /* swallow */ }
  }
  return q;
}

export async function getCompanyInfo(symbol: string): Promise<CompanyInfo | null> {
  const fetcher = getFetcher();
  if (!fetcher.fetchCompanyInfo) return null;
  return fetcher.fetchCompanyInfo(symbol);
}
