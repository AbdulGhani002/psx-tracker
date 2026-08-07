// Zakat on financial assets, the way it is actually practised in Pakistan.
//
// The rules encoded here:
//   - Rate: 2.5% of net zakatable wealth, once per LUNAR year (haul). If the
//     user anchors on a solar date some scholars use 2.577% to compensate; we
//     note it and keep 2.5% — the note is theirs to act on.
//   - Nisab: the exemption threshold. Gold nisab = 87.48 g (7.5 tola), silver
//     nisab = 612.36 g (52.5 tola), at 11.6638 g/tola. For MIXED wealth (cash,
//     funds, shares) the SILVER nisab is the operative one in common Pakistani
//     practice — it is the lower bar, so it is the cautious choice.
//   - Zakatable: cash, bank/savings balances, mutual funds, and listed shares.
//     Shares held for TRADING are zakatable at full market value; for long-term
//     investors AAOIFI permits paying only on the company's zakatable assets —
//     we surface that as a note and let the user exclude, never decide for them.
//   - Deductible: immediate liabilities (bills due, borrowed money) — user input.
//   - CZ-50: Pakistani banks auto-deduct 2.5% from PLS savings accounts above
//     nisab on the 1st of Ramadan unless a CZ-50 exemption declaration is filed.
//
// Prices for nisab come from live gold/silver quotes (Yahoo × SBP USD/PKR).
// If the SILVER price is unavailable the verdict is UNKNOWN — we refuse to
// guess the threshold that decides whether zakat is due at all.

export const GRAMS_PER_TOLA = 11.6638;
export const GOLD_NISAB_GRAMS = 7.5 * GRAMS_PER_TOLA; // 87.4785
export const SILVER_NISAB_GRAMS = 52.5 * GRAMS_PER_TOLA; // 612.3495
export const ZAKAT_RATE = 0.025; // lunar-year rate
export const TROY_OZ_GRAMS = 31.1034768;

export type ZakatCategory = {
  key: string;
  label: string;
  amount: number; // PKR market value today
  included: boolean;
  note?: string;
};

export type ZakatInput = {
  categories: ZakatCategory[];
  liabilitiesPkr: number; // immediate debts the user nets off
  silverPkrPerGram: number | null;
  goldPkrPerGram: number | null;
};

export type ZakatResult = {
  zakatableTotal: number; // included categories, gross
  netBase: number; // after liabilities, floored at 0
  nisabSilverPkr: number | null; // the operative threshold
  nisabGoldPkr: number | null; // shown for reference
  aboveNisab: boolean | null; // null = silver price unknown → can't say
  duePkr: number | null; // 2.5% of base when above nisab; 0 when below; null when unknown
  ratePct: number;
};

// PKR per gram from a USD-per-troy-ounce quote and a USD/PKR rate.
export function pkrPerGram(usdPerOz: number | null, usdPkr: number | null): number | null {
  if (usdPerOz == null || usdPkr == null || !(usdPerOz > 0) || !(usdPkr > 0)) return null;
  return (usdPerOz * usdPkr) / TROY_OZ_GRAMS;
}

export function computeZakat(i: ZakatInput): ZakatResult {
  const zakatableTotal = i.categories.filter((c) => c.included).reduce((s, c) => s + Math.max(0, c.amount), 0);
  const netBase = Math.max(0, zakatableTotal - Math.max(0, i.liabilitiesPkr));

  const nisabSilverPkr = i.silverPkrPerGram != null ? SILVER_NISAB_GRAMS * i.silverPkrPerGram : null;
  const nisabGoldPkr = i.goldPkrPerGram != null ? GOLD_NISAB_GRAMS * i.goldPkrPerGram : null;

  // No silver price → no threshold → no verdict. An invented nisab could tell
  // someone zakat is not due when it is.
  const aboveNisab = nisabSilverPkr == null ? null : netBase >= nisabSilverPkr;
  const duePkr = aboveNisab == null ? null : aboveNisab ? netBase * ZAKAT_RATE : 0;

  return {
    zakatableTotal,
    netBase,
    nisabSilverPkr,
    nisabGoldPkr,
    aboveNisab,
    duePkr,
    ratePct: ZAKAT_RATE * 100,
  };
}
