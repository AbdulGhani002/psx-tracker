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

// Latest snapshot per symbol in ONE aggregation, instead of a query per symbol
// (every page that prices the portfolio used to fan out N round-trips).
async function readLatestBatch(symbols: string[]): Promise<Map<string, PriceQuote>> {
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const m = new Map<string, PriceQuote>();
  if (upper.length === 0) return m;
  const rows: any[] = await PriceSnapshotModel.aggregate([
    { $match: { symbol: { $in: upper } } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: "$symbol", price: { $first: "$price" }, timestamp: { $first: "$timestamp" }, source: { $first: "$source" } } },
  ]);
  for (const r of rows) m.set(r._id, { symbol: r._id, price: r.price, timestamp: new Date(r.timestamp), source: r.source });
  return m;
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
  const upper = symbols.map((s) => s.toUpperCase());

  const cache = await readLatestBatch(upper); // single round-trip
  const stale: string[] = [];
  for (const sym of upper) {
    const cached = cache.get(sym);
    if (cached && isFresh(cached)) out.set(sym, cached.price);
    else stale.push(sym);
  }

  if (stale.length > 0) {
    const fresh = await fetcher.fetchBatch(stale);
    for (const [sym, quote] of fresh) {
      out.set(sym, quote.price);
      try { await writeSnapshot(quote); } catch { /* swallow */ }
    }
    // Fall back to the last-known price for anything we couldn't refresh.
    for (const sym of stale) {
      if (!out.has(sym)) {
        const cached = cache.get(sym);
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
