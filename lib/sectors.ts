export type SectorInfo = {
  symbol: string;
  name: string;
  sector: string;
  shariaCompliant: boolean;
};

export const PSX_SECTOR_MAP: Record<string, SectorInfo> = {
  MUREB: { symbol: "MUREB", name: "Murree Brewery Company Limited", sector: "Food & Personal Care", shariaCompliant: false },
  MEBL:  { symbol: "MEBL",  name: "Meezan Bank Limited",            sector: "Commercial Banks",      shariaCompliant: true },
  AHCL:  { symbol: "AHCL",  name: "Asia Insurance Company Limited", sector: "Insurance",             shariaCompliant: false },
  HUBC:  { symbol: "HUBC",  name: "The Hub Power Company Limited",  sector: "Power Generation",      shariaCompliant: true },
  PTL:   { symbol: "PTL",   name: "Pakistan Telecommunication Co.", sector: "Telecommunication",     shariaCompliant: false },
  OGDC:  { symbol: "OGDC",  name: "Oil & Gas Development Company",  sector: "Oil & Gas Exploration", shariaCompliant: true },
  PPL:   { symbol: "PPL",   name: "Pakistan Petroleum Limited",     sector: "Oil & Gas Exploration", shariaCompliant: true },
  ENGRO: { symbol: "ENGRO", name: "Engro Corporation Limited",      sector: "Diversified Industrials", shariaCompliant: true },
  FFC:   { symbol: "FFC",   name: "Fauji Fertilizer Company",       sector: "Fertilizer",            shariaCompliant: true },
  LUCK:  { symbol: "LUCK",  name: "Lucky Cement Limited",           sector: "Cement",                shariaCompliant: true },
  POL:   { symbol: "POL",   name: "Pakistan Oilfields Limited",     sector: "Oil & Gas Exploration", shariaCompliant: true },
  SYS:   { symbol: "SYS",   name: "Systems Limited",                sector: "Technology",            shariaCompliant: true },
  UBL:   { symbol: "UBL",   name: "United Bank Limited",            sector: "Commercial Banks",      shariaCompliant: false },
  HBL:   { symbol: "HBL",   name: "Habib Bank Limited",             sector: "Commercial Banks",      shariaCompliant: false },
  MCB:   { symbol: "MCB",   name: "MCB Bank Limited",               sector: "Commercial Banks",      shariaCompliant: false },
  ABL:   { symbol: "ABL",   name: "Allied Bank Limited",            sector: "Commercial Banks",      shariaCompliant: false },
  PSO:   { symbol: "PSO",   name: "Pakistan State Oil Company",     sector: "Oil & Gas Marketing",   shariaCompliant: true },
  KEL:   { symbol: "KEL",   name: "K-Electric Limited",             sector: "Power Generation",      shariaCompliant: true },
  TRG:   { symbol: "TRG",   name: "TRG Pakistan Limited",           sector: "Technology",            shariaCompliant: true },
  EFERT: { symbol: "EFERT", name: "Engro Fertilizers Limited",      sector: "Fertilizer",            shariaCompliant: true },
  DGKC:  { symbol: "DGKC",  name: "D.G. Khan Cement Limited",       sector: "Cement",                shariaCompliant: true },
  NESTLE:{ symbol: "NESTLE",name: "Nestle Pakistan Limited",        sector: "Food & Personal Care",  shariaCompliant: true },
  UNILEVER:{symbol: "UNILEVER", name: "Unilever Pakistan Foods Ltd", sector: "Food & Personal Care", shariaCompliant: true },
};

export function getSectorInfo(symbol: string): SectorInfo {
  const upper = symbol.toUpperCase();
  return (
    PSX_SECTOR_MAP[upper] ?? {
      symbol: upper,
      name: upper,
      sector: "Other",
      shariaCompliant: false,
    }
  );
}
