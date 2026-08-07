// Valuing a share as what it actually pays you: a dividend stream.
//
// WHY THIS EXISTS, SEPARATE FROM intrinsic.ts
// Some PSX names are not really "an earnings multiple". A holding company like
// AHCL owns stakes and hands cash up; it has paid dividends OUT OF RESERVES in
// years its own EPS didn't cover them. For a share like that, "fair P/E × EPS"
// is close to meaningless, and even sum-of-the-parts NAV only tells you what it
// OWNS — not what it PAYS you. The honest third read is: treat it as an income
// stream and ask what that stream is worth at a Pakistani discount rate.
//
// THE PRINCIPLES THIS ENCODES
// 1. r is built from the LOCAL risk-free. Pakistan's policy rate (fetched live
//    from SBP, ~11.5%) plus an equity risk premium — not an imported US number.
// 2. r and g are JUDGEMENTS, not facts. So the output is a GRID, not a single
//    confident figure. A model that prints one number hides how violently the
//    answer moves when r−g narrows.
// 3. The company's OWN disclosed model outranks ours. If AHCL's audited accounts
//    carry a Level-3 fair value built on r=16%, g=5% and an auditor signed it
//    off, that is a better anchor than anything we invent — so we record it,
//    cite it, and show it next to our grid. (Entered from the annual report by
//    hand; never guessed. See DisclosedModel.)
//
// Formula: P = D0 × (1 + g) / (r − g)   [Gordon growth / constant-growth DDM]
// Note it is D0×(1+g) — the NEXT dividend — not D0. Using D0 understates value
// by exactly one year of growth (at r=16%, g=5% on D0=1.35: 12.27 vs 12.89).

export type GordonCell = {
  rPct: number;
  gPct: number;
  value: number | null; // null when r <= g (the model has no finite answer)
  fragile: boolean; // r − g is thin: the value is arithmetic, not a forecast
};

export type GordonGrid = {
  baseDps: number;
  rGrid: number[];
  gGrid: number[];
  rows: GordonCell[][]; // rows[r][g]
};

// Below this spread the denominator dominates and the "value" is really just
// 1/(r−g) blowing up. We still SHOW those cells — seeing 50.40 appear at r−g=3%
// is the whole point of a sensitivity grid — but we flag them so nobody quotes
// one as a target.
const FRAGILE_SPREAD = 0.04;

export function gordonValue(baseDps: number, rPct: number, gPct: number): GordonCell {
  const r = rPct / 100;
  const g = gPct / 100;
  const spread = r - g;
  if (!Number.isFinite(baseDps) || baseDps <= 0 || spread <= 0) {
    return { rPct, gPct, value: null, fragile: true };
  }
  return {
    rPct,
    gPct,
    value: (baseDps * (1 + g)) / spread,
    fragile: spread < FRAGILE_SPREAD,
  };
}

export function gordonGrid(baseDps: number, rGrid: number[], gGrid: number[]): GordonGrid {
  return {
    baseDps,
    rGrid,
    gGrid,
    rows: rGrid.map((rPct) => gGrid.map((gPct) => gordonValue(baseDps, rPct, gPct))),
  };
}

// Required return = local risk-free + equity risk premium.
// The risk-free must be SBP's published policy rate (see lib/feeds/sbp.ts), not
// a hardcoded guess — that exact shortcut previously ran the whole app on a
// placeholder 10.5% when the real rate was 11.5%.
export function requiredReturnPct(riskFreePct: number, equityRiskPremiumPct: number): number {
  return riskFreePct + equityRiskPremiumPct;
}

// A grid centred on the required return, so the user sees their own r in the
// middle with cheaper/dearer discount rates either side.
export function defaultRateGrid(centreRPct: number): number[] {
  const c = Math.round(centreRPct);
  return [c - 2, c - 1, c, c + 1, c + 3];
}

// A valuation the COMPANY itself discloses — e.g. the Level-3 fair-value model
// in its audited accounts. This is transcribed from the report by hand and must
// carry its source; it is evidence, not our opinion. Never populate it from a
// guess: an empty disclosed model is fine, an invented one is not.
export type DisclosedModel = {
  requiredReturnPct: number; // the r the company/auditor used
  growthPct: number; // the g the company/auditor used
  baseDps: number; // the dividend the model was built on
  source: string; // e.g. "FY25 accounts, Level-3 fair value, signed off by A.F. Ferguson"
  asOf: string; // ISO date of the report
};

export function disclosedValue(m: DisclosedModel | null | undefined): GordonCell | null {
  if (!m) return null;
  return gordonValue(m.baseDps, m.requiredReturnPct, m.growthPct);
}

// What growth the CURRENT price implies, holding r fixed — the most useful
// single question a grid can answer: "what does the market already believe?"
// Rearranged from P = D0(1+g)/(r−g):  g = (P·r − D0) / (P + D0)
export function impliedGrowthPct(price: number, baseDps: number, rPct: number): number | null {
  if (!(price > 0) || !(baseDps > 0)) return null;
  const r = rPct / 100;
  const g = (price * r - baseDps) / (price + baseDps);
  if (!Number.isFinite(g) || g >= r) return null; // price implies g >= r → no finite Gordon value
  return g * 100;
}

// What discount rate the CURRENT price implies, holding g fixed:
//   r = D0(1+g)/P + g
export function impliedReturnPct(price: number, baseDps: number, gPct: number): number | null {
  if (!(price > 0) || !(baseDps > 0)) return null;
  const g = gPct / 100;
  const r = (baseDps * (1 + g)) / price + g;
  return Number.isFinite(r) ? r * 100 : null;
}
