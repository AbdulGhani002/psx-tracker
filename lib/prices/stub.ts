import type { PriceFetcher, PriceQuote } from "./types";

const STUB_PRICES: Record<string, number> = {
  MUREB: 1140,
  MEBL: 295,
  AHCL: 14.5,
  HUBC: 152,
  PTL: 23.8,
  OGDC: 245,
  PPL: 168,
  ENGRO: 322,
  FFC: 442,
  LUCK: 1240,
  POL: 685,
  SYS: 690,
  UBL: 358,
  HBL: 138,
  MCB: 305,
  ABL: 152,
  PSO: 318,
  KEL: 5.4,
  TRG: 51,
  EFERT: 215,
  DGKC: 134,
  NESTLE: 7150,
  UNILEVER: 22500,
};

export class StubFetcher implements PriceFetcher {
  readonly name = "stub";

  async fetchPrice(symbol: string): Promise<PriceQuote | null> {
    const upper = symbol.toUpperCase();
    const price = STUB_PRICES[upper];
    if (price == null) return null;
    return { symbol: upper, price, timestamp: new Date(), source: this.name };
  }

  async fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    for (const s of symbols) {
      const q = await this.fetchPrice(s);
      if (q) out.set(q.symbol, q);
    }
    return out;
  }
}
