export type PriceQuote = {
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
};

export interface PriceFetcher {
  name: string;
  fetchPrice(symbol: string): Promise<PriceQuote | null>;
  fetchBatch(symbols: string[]): Promise<Map<string, PriceQuote>>;
}

export const PSX_MARKET_HOURS = {
  open: { hour: 9, minute: 30 },
  close: { hour: 15, minute: 30 },
};

export function isMarketHoursNow(d = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false; // Sun/Sat closed
  // Convert to PKT for the comparison (server may be UTC).
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const pktMinutes = (utcMinutes + 5 * 60) % (24 * 60);
  const openMin = PSX_MARKET_HOURS.open.hour * 60 + PSX_MARKET_HOURS.open.minute;
  const closeMin = PSX_MARKET_HOURS.close.hour * 60 + PSX_MARKET_HOURS.close.minute;
  return pktMinutes >= openMin && pktMinutes <= closeMin;
}
