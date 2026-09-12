import type { CompanyInfo, PriceFetcher, PriceQuote } from "./types";
import { decodeEntities, titleCase } from "./types";

const PSX_URL = (sym: string) => `https://dps.psx.com.pk/company/${encodeURIComponent(sym)}`;
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

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

export async function fetchPSXPage(symbol: string): Promise<PSXSnapshot | null> {
  const upper = symbol.toUpperCase();
  try {
    const res = await fetch(PSX_URL(upper), {
      headers: { "user-agent": UA, accept: "text/html" },
      cache: "no-store",
      // The portal, when it is refusing the server's address, either closes at
      // once or hangs; neither may hold a page for long.
      signal: AbortSignal.timeout(4000),
    });
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
  private readonly delayMs: number;

  constructor(opts?: { delayMs?: number }) {
    this.delayMs = opts?.delayMs ?? 1500;
  }

  async fetchPrice(symbol: string): Promise<PriceQuote | null> {
    const snap = await fetchPSXPage(symbol);
    if (!snap || snap.price == null) return null;
    return {
      symbol: snap.symbol,
      price: snap.price,
      timestamp: new Date(),
      source: this.name,
      asOf: snap.asOf ?? undefined,
    };
  }

  async fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    let misses = 0;
    for (const s of symbols) {
      const q = await this.fetchPrice(s);
      if (q) {
        out.set(q.symbol, q);
        misses = 0;
      } else if (++misses >= 3 && out.size === 0) {
        // Three straight failures with nothing back: the portal is not
        // answering this address today. Stop asking; the caller falls back.
        break;
      }
      await new Promise((r) => setTimeout(r, this.delayMs));
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
