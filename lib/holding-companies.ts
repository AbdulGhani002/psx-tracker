// Known PSX holding companies and their stakes, so the look-through can be
// one-click populated. Listed stakes are valued live; unlisted ones have no PSX
// price and are surfaced as a note for the user to value in "unlisted / other".
// Percentages are from the latest available annual reports / disclosures and are
// EDITABLE once loaded — treat them as a starting point to verify, not gospel.

export type KnownConstituent = { label: string; symbol: string; ownershipPct: number };
export type KnownUnlisted = { label: string; note: string; ownershipPct?: number; valuePkr?: number };

export type KnownHoldingCompany = {
  symbol: string;
  name: string;
  listed: KnownConstituent[];
  unlisted: KnownUnlisted[];
  sharesOutstanding?: number; // pin if known (else derived from profit/EPS)
  // True for OPERATING companies that also hold investments (e.g. Fatima): the
  // sum of their stakes is a portfolio INSIDE the business, not the company's
  // value, so we show the holdings as a tree but never as a NAV/discount.
  investmentsOnly?: boolean;
  source: string;
};

export const KNOWN_HOLDING_COMPANIES: Record<string, KnownHoldingCompany> = {
  AHCL: {
    symbol: "AHCL",
    name: "Arif Habib Corporation",
    // Ownership % from AHCL Annual Report FY2024 (related-party note); AHL stake
    // updated to FY2025 (74.32%). Shares post 10-for-1 split (face Rs 1).
    listed: [
      { label: "Fatima Fertilizer", symbol: "FATIMA", ownershipPct: 15.19 },
      { label: "Javedan Corp", symbol: "JVDC", ownershipPct: 19.84 },
      { label: "Safe Mix Concrete", symbol: "SMCPL", ownershipPct: 32.4 },
      { label: "Aisha Steel", symbol: "ASL", ownershipPct: 13.8 },
      { label: "Power Cement", symbol: "POWER", ownershipPct: 6.5 },
      { label: "Arif Habib Ltd", symbol: "AHL", ownershipPct: 74.32 },
    ],
    unlisted: [
      { label: "Sachal Energy Development", ownershipPct: 85.83, valuePkr: 2746000000, note: "Wind 49.5MW; FY24 cost basis Rs 2.75bn — update to current fair value" },
      { label: "Black Gold Power", ownershipPct: 100, valuePkr: 0, note: "Thar coal 660MW; impaired to nil in accounts" },
      { label: "Rayaan Commodities", ownershipPct: 100, valuePkr: 0, note: "PMEX broker; held via AHL" },
      { label: "PIA (PIAHCLA)", ownershipPct: 0, valuePkr: 0, note: "Jan-2026 consortium via PIA Equity Ltd; AHCL's individual stake not disclosed (AHCL+Fatima ~34.1% combined). Enter a value once known." },
    ],
    sharesOutstanding: 4216967470,
    source: "AHCL AR FY2024/FY2025; AHL AR FY2025; PSX. Verify unlisted values.",
  },
  FATIMA: {
    symbol: "FATIMA",
    name: "Fatima Fertilizer",
    // FATIMA owns NO separately-listed company — all stakes are unlisted
    // subsidiaries/associates/REITs (FY2025 separate accounts, Note 23: subs at
    // cost, associates at equity). It is primarily an operating fertilizer
    // business, so these ~Rs 49bn of holdings are a portfolio INSIDE it, not its
    // value — shown as a tree, never as a NAV (investmentsOnly).
    listed: [],
    unlisted: [
      { label: "Pakarab Fertilizers", ownershipPct: 100, valuePkr: 15735773000, note: "Subsidiary (holds Multan plant from Jan-2025); at cost" },
      { label: "Fatima Capital", ownershipPct: 100, valuePkr: 13383653000, note: "Subsidiary; holds FATIMA's listed-securities portfolio (since Dec-2025)" },
      { label: "Fatimafert", ownershipPct: 100, valuePkr: 7195099000, note: "Subsidiary (Sheikhupura urea plant); at cost" },
      { label: "Fatima Cement", ownershipPct: 100, valuePkr: 1400030000, note: "Subsidiary; at cost" },
      { label: "Fatima Packaging", ownershipPct: 100, valuePkr: 685279000, note: "Subsidiary; at cost" },
      { label: "Fatima Petroleum", ownershipPct: 100, valuePkr: 125020000, note: "Subsidiary (new Jul-2025)" },
      { label: "National Resources", ownershipPct: 33, valuePkr: 739793000, note: "Associate; Balochistan copper/gold JV with Lucky Cement" },
      { label: "Multan Real Estate", ownershipPct: 28.37, valuePkr: 94933000, note: "Associate" },
      { label: "Globacore Minerals", ownershipPct: 32, valuePkr: 37057000, note: "Associate (new 2025)" },
      { label: "Fatima Agri Sales & Services", ownershipPct: 49, valuePkr: 34648000, note: "Associate" },
      { label: "Emerald Bay Islamic Dev REIT", ownershipPct: 27.82, valuePkr: 4920757000, note: "REIT units" },
      { label: "Pakistan Corporate CBD REIT", ownershipPct: 33, valuePkr: 2703994000, note: "REIT units" },
      { label: "Silk Islamic Dev REIT", ownershipPct: 20, valuePkr: 704400000, note: "REIT units" },
      { label: "Sapphire Bay Islamic Dev REIT", ownershipPct: 6.25, valuePkr: 672329000, note: "REIT units" },
      { label: "Bank Al-Habib TFC", ownershipPct: 0, valuePkr: 750000000, note: "Term-finance certificate (amortised cost)" },
      { label: "Agritech Preference Shares", ownershipPct: 0, valuePkr: 90957000, note: "Class-A preference shares" },
      { label: "Fatima Electric", ownershipPct: 40, valuePkr: 0, note: "Associate; equity-accounted to nil" },
      { label: "Singfert / Midwest Fertilizer (USA)", ownershipPct: 25, valuePkr: 0, note: "Associate via Singapore SPV; carried at nil" },
      { label: "Buraq Bank (digital)", ownershipPct: 25, valuePkr: 25000, note: "Associate (ex-KT Bank)" },
    ],
    sharesOutstanding: 2100000000,
    investmentsOnly: true,
    source: "Fatima Fertilizer AR FY2025 (separate accounts, Notes 23 & 42.1). Book/carrying values — a floor, not market.",
  },
  HUBC: {
    symbol: "HUBC",
    name: "Hub Power Company",
    // HUBCO owns NO separately-listed company — every stake is unlisted/private.
    // So there are no live-priced constituents; this is a book-value SOTP using
    // FY2025 equity-method carrying amounts (a floor, not market value). You MUST
    // add HUBCO's own parent net debt for the NAV to be meaningful.
    listed: [],
    unlisted: [
      { label: "CPHGC (1,320MW coal)", ownershipPct: 47.5, valuePkr: 156990000000, note: "Associate; FY25 equity-method carrying value (floor, not market)" },
      { label: "ThalNova Power (330MW)", ownershipPct: 38.3, valuePkr: 17480000000, note: "JV; FY25 carrying value" },
      { label: "Prime Intl Oil & Gas (ex-Eni)", ownershipPct: 50, valuePkr: 13780000000, note: "JV E&P; FY25 carrying value" },
      { label: "Sindh Engro Coal (SECMC)", ownershipPct: 8, valuePkr: 5240000000, note: "Thar Block II mine; FY25 carrying value" },
      { label: "Thar Energy (330MW)", ownershipPct: 60, valuePkr: 0, note: "Subsidiary; add carrying value from AR" },
      { label: "Narowal Energy (225MW)", ownershipPct: 100, valuePkr: 0, note: "Subsidiary; add carrying value" },
      { label: "Laraib Energy (84MW hydel)", ownershipPct: 74.95, valuePkr: 0, note: "Subsidiary; add carrying value" },
      { label: "Mega Motor (BYD EV)", ownershipPct: 50, valuePkr: 0, note: "Associate; add carrying value" },
      { label: "Hubco Green (EV/renewables)", ownershipPct: 100, valuePkr: 0, note: "Subsidiary; add carrying value" },
    ],
    source: "HUBCO Integrated AR FY2025 (Notes 1 & 16). ALL holdings unlisted — add parent net debt for a true NAV.",
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
