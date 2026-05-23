import type { CompanyInfo, PriceFetcher, PriceQuote } from "./types";

// Dev-only fallback. Returns nothing real — the live app uses PSXScraperFetcher.
// Kept for offline development; never used when PRICE_FETCHER_STRATEGY=psx-scraper.
export class StubFetcher implements PriceFetcher {
  readonly name = "stub";

  async fetchPrice(symbol: string): Promise<PriceQuote | null> {
    return {
      symbol: symbol.toUpperCase(),
      price: 100,
      timestamp: new Date(),
      source: this.name,
    };
  }

  async fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    for (const s of symbols) {
      const q = await this.fetchPrice(s);
      if (q) out.set(q.symbol, q);
    }
    return out;
  }

  async fetchCompanyInfo(symbol: string): Promise<CompanyInfo | null> {
    return { symbol: symbol.toUpperCase(), name: symbol.toUpperCase(), sector: "Unknown" };
  }
}
