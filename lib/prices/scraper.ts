import type { PriceFetcher, PriceQuote } from "./types";

const PSX_URL = (sym: string) => `https://dps.psx.com.pk/company/${encodeURIComponent(sym)}`;
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1; +contact@example.com)";

function extractPrice(html: string): number | null {
  // dps.psx.com.pk page renders the last price inside a <div class="quote__close">XXX.XX</div>
  // We try multiple patterns to stay resilient.
  const patterns = [
    /quote__close[^>]*>\s*([\d,]+\.?\d*)/i,
    /lastPrice"\s*:\s*"?([\d,]+\.?\d*)/i,
    /class=["']price[^"']*["'][^>]*>\s*([\d,]+\.?\d*)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export class PSXScraperFetcher implements PriceFetcher {
  readonly name = "psx-scraper";
  private readonly delayMs: number;

  constructor(opts?: { delayMs?: number }) {
    this.delayMs = opts?.delayMs ?? 2000;
  }

  async fetchPrice(symbol: string): Promise<PriceQuote | null> {
    const upper = symbol.toUpperCase();
    try {
      const res = await fetch(PSX_URL(upper), {
        headers: { "user-agent": UA, accept: "text/html" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const html = await res.text();
      const price = extractPrice(html);
      if (price == null) return null;
      return { symbol: upper, price, timestamp: new Date(), source: this.name };
    } catch {
      return null;
    }
  }

  async fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    for (const s of symbols) {
      const q = await this.fetchPrice(s);
      if (q) out.set(q.symbol, q);
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    return out;
  }
}
