// Known PSX holding companies and their stakes, so the look-through can be
// one-click populated. Listed stakes are valued live; unlisted ones have no PSX
// price and are surfaced as a note for the user to value in "unlisted / other".
// Percentages are from the latest available annual reports / disclosures and are
// EDITABLE once loaded — treat them as a starting point to verify, not gospel.

export type KnownConstituent = { label: string; symbol: string; ownershipPct: number };
export type KnownUnlisted = { label: string; note: string };

export type KnownHoldingCompany = {
  symbol: string;
  name: string;
  listed: KnownConstituent[];
  unlisted: KnownUnlisted[];
  source: string;
};

export const KNOWN_HOLDING_COMPANIES: Record<string, KnownHoldingCompany> = {
  AHCL: {
    symbol: "AHCL",
    name: "Arif Habib Corporation",
    listed: [
      { label: "Fatima Fertilizer", symbol: "FATIMA", ownershipPct: 15.19 },
      { label: "Javedan Corp", symbol: "JVDC", ownershipPct: 19.84 },
      { label: "Aisha Steel", symbol: "ASL", ownershipPct: 13.8 },
      { label: "Power Cement", symbol: "POWER", ownershipPct: 6.5 },
      { label: "Arif Habib Ltd", symbol: "AHL", ownershipPct: 72.92 },
    ],
    unlisted: [
      { label: "Sachal Energy Development", note: "85.83% (unlisted)" },
      { label: "Black Gold Power", note: "subsidiary (unlisted)" },
      { label: "Rayaan Commodities", note: "72.92% (unlisted)" },
      { label: "PIA (consortium)", note: "strategic stake (unlisted)" },
    ],
    source: "AHCL annual report / PSX disclosures",
  },
  ENGROH: {
    symbol: "ENGROH",
    name: "Engro Holdings (ex-Dawood Hercules)",
    listed: [{ label: "Engro Corporation", symbol: "ENGRO", ownershipPct: 0 }],
    unlisted: [],
    source: "Jan-2025 restructuring — verify the ENGRO stake %",
  },
  // Older symbol, in case it appears in holdings before the rename.
  DAWH: {
    symbol: "DAWH",
    name: "Dawood Hercules (now Engro Holdings)",
    listed: [{ label: "Engro Corporation", symbol: "ENGRO", ownershipPct: 0 }],
    unlisted: [],
    source: "renamed to ENGROH in Jan 2025 — verify the stake %",
  },
};

export function knownHoldingCompany(symbol: string): KnownHoldingCompany | null {
  return KNOWN_HOLDING_COMPANIES[symbol.toUpperCase()] ?? null;
}
