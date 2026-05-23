// No hardcoded company map. Company name + sector are discovered from PSX
// (dps.psx.com.pk/company/SYMBOL) the first time a symbol is recorded.
// This fallback is used only when the scrape fails and the user is creating a
// holding manually.

export type SectorInfo = {
  symbol: string;
  name: string;
  sector: string;
  shariaCompliant: boolean;
};

export function getSectorInfo(symbol: string): SectorInfo {
  const upper = symbol.toUpperCase();
  return { symbol: upper, name: upper, sector: "Unknown", shariaCompliant: false };
}
