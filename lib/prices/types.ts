export type PriceQuote = {
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
  asOf?: string; // human-readable "As of …" string from PSX, if available
};

export type CompanyInfo = {
  symbol: string;
  name: string;
  sector: string;
};

export interface PriceFetcher {
  name: string;
  fetchPrice(symbol: string): Promise<PriceQuote | null>;
  fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>>;
  fetchCompanyInfo?(symbol: string): Promise<CompanyInfo | null>;
}

export const PSX_MARKET_HOURS = {
  open: { hour: 9, minute: 30 },
  close: { hour: 15, minute: 30 },
};

export function isMarketHoursNow(d = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const pktMinutes = (utcMinutes + 5 * 60) % (24 * 60);
  const openMin = PSX_MARKET_HOURS.open.hour * 60 + PSX_MARKET_HOURS.open.minute;
  const closeMin = PSX_MARKET_HOURS.close.hour * 60 + PSX_MARKET_HOURS.close.minute;
  return pktMinutes >= openMin && pktMinutes <= closeMin;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(#?[a-z0-9]+);/gi, (_m, code) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(parseInt(code.slice(1), 10));
      }
      return ENTITY_MAP[code.toLowerCase()] ?? `&${code};`;
    })
    .trim();
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s|-|\/|&)([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}
