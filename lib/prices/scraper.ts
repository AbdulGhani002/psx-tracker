import type { CompanyInfo, PriceFetcher, PriceQuote } from "./types";
import { decodeEntities, titleCase } from "./types";
import { dpsFetch } from "@/lib/prices/dps";
import { fetchAllPrices } from "@/lib/timeseries/dps-indices";
import { isMarketHoursNow } from "./types";

const PSX_URL = (sym: string) => `https://dps.psx.com.pk/company/${encodeURIComponent(sym)}`;

function extractField(html: string, klass: string, nestedSpan = false): string | null {
  const inner = nestedSpan
    ? new RegExp(`class="${klass}"[^>]*>\\s*<span[^>]*>([^<]+)<`, "i")
    : new RegExp(`class="${klass}"[^>]*>([^<]+)<`, "i");
  const m = html.match(inner);
  return m ? decodeEntities(m[1]) : null;
}

function parseCloseRs(raw: string | null): number | null {
  if (!raw) return null;
  const stripped = raw.replace(/Rs\.?/i, "").replace(/,/g, "").trim();
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

export type PSXSnapshot = {
  symbol: string;
  price: number | null;
  name: string | null;
  sector: string | null;
  asOf: string | null;
};

// `relay: false` for a price: a page the home machine pushed last night is
// no price for now (its name and sector are fine).
export async function fetchPSXPage(symbol: string, relay = true): Promise<PSXSnapshot | null> {
  const upper = symbol.toUpperCase();
  try {
    // The portal, when it is refusing the server's address, either closes at
    // once or hangs; neither may hold a page for long.
    const res = await dpsFetch(PSX_URL(upper), { headers: { accept: "text/html" } }, { timeoutMs: 4000, relay });
    if (!res.ok) return null;
    const html = await res.text();
    const priceRaw = extractField(html, "quote__close");
    const name = extractField(html, "quote__name");
    const sectorRaw = extractField(html, "quote__sector", true);
    const asOfRaw = extractField(html, "quote__date");
    const sector = sectorRaw ? titleCase(sectorRaw) : null;
    const asOf = asOfRaw ? asOfRaw.replace(/^\^?\s*As of\s*/i, "").trim() : null;
    return {
      symbol: upper,
      price: parseCloseRs(priceRaw),
      name: name ?? null,
      sector,
      asOf,
    };
  } catch {
    return null;
  }
}

export class PSXScraperFetcher implements PriceFetcher {
  readonly name = "psx-scraper";

  async fetchPrice(symbol: string): Promise<PriceQuote | null> {
    const snap = await fetchPSXPage(symbol, false);
    if (!snap || snap.price == null) return null;
    return {
      symbol: snap.symbol,
      price: snap.price,
      timestamp: new Date(),
      source: this.name,
      asOf: snap.asOf ?? undefined,
    };
  }

  // Every name at once from the All-Share index page, one request a quarter
  // of an hour at most, and only while the market trades: outside its hours
  // the day's close stands (getPrices falls back to the evening file's).
  async fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    if (!isMarketHoursNow()) return out;
    const board = await fetchAllPrices().catch(() => null);
    if (!board) return out;
    const now = new Date();
    for (const s of symbols) {
      const r = board.get(s.toUpperCase());
      const price = r ? (r.current > 0 ? r.current : r.ldcp) : 0;
      if (price > 0) out.set(s.toUpperCase(), { symbol: s.toUpperCase(), price, timestamp: now, source: this.name });
    }
    return out;
  }

  async fetchCompanyInfo(symbol: string): Promise<CompanyInfo | null> {
    const snap = await fetchPSXPage(symbol);
    if (!snap) return null;
    if (!snap.name && !snap.sector) return null;
    return {
      symbol: snap.symbol,
      name: snap.name ?? snap.symbol,
      sector: snap.sector ?? "Unknown",
    };
  }
}
