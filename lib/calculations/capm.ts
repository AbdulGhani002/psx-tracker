// The required return for a Pakistani share, done per-company instead of flat.
//
// THE PROBLEM WITH ONE NUMBER FOR EVERYTHING
// The app used r = SBP rate + a single equity risk premium for every stock. So a
// power utility, a bank and a cement cyclical all had to clear the same hurdle.
// They plainly shouldn't: they carry different amounts of market risk.
//
// WHAT WE DO INSTEAD — CAPM:  r = risk-free + β × ERP
//   risk-free : SBP's published policy rate (live, lib/feeds/sbp.ts)
//   β         : the share's OWN beta vs the KSE-100, measured from real prices
//   ERP       : the equity risk premium you demand over the risk-free rate
//
// WHY β IS ADJUSTED (this matters a lot on PSX)
// Raw betas are biased DOWNWARD by thin trading: a share that barely trades looks
// uncorrelated with the index, so it scores a low beta and therefore a low hurdle
// — exactly backwards, because illiquidity is a risk, not a comfort. PSX is full
// of thin names (a REIT measured at β=0.20 would imply a ~12.6% required return,
// which no Pakistani investor would accept for a REIT).
//
// So we apply the Blume adjustment — β_adj = 0.67 × β_raw + 0.33 × 1.0 — which
// shrinks measured betas toward the market. It is the standard correction (Blume,
// 1971: betas mean-revert toward 1 over time) and it is what Bloomberg reports as
// "adjusted beta". It is a documented method, not a fudge factor.
//
// Missing beta → β = 1 (plain market risk), so the stock gets exactly the old
// flat treatment. We never invent a beta.

export type RequiredReturn = {
  requiredReturnPct: number;
  riskFreePct: number;
  erpPct: number;
  betaRaw: number | null; // as measured; null when we have no series
  betaUsed: number; // after Blume adjustment + clamp; 1 when unknown
  betaSource: "measured" | "assumed-market";
};

// Blume: pull the measured beta two-thirds of the way from 1 toward itself.
export function blumeAdjustedBeta(rawBeta: number): number {
  return 0.67 * rawBeta + 0.33;
}

// After adjustment, keep beta inside a band real PSX equities live in. Below ~0.4
// the hurdle drops under the money-market rate (nonsense for equity); above ~2.0
// a single volatile stretch would price the share at nothing.
export const BETA_MIN = 0.4;
export const BETA_MAX = 2.0;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function requiredReturn(input: {
  riskFreePct: number;
  erpPct: number;
  betaRaw?: number | null;
}): RequiredReturn {
  const { riskFreePct, erpPct } = input;
  const raw = input.betaRaw;
  const usable = raw != null && Number.isFinite(raw);
  // No beta → assume the stock carries plain market risk (β = 1). That reproduces
  // the old flat "risk-free + ERP" exactly, which is the honest neutral position.
  const betaUsed = usable ? clamp(blumeAdjustedBeta(raw as number), BETA_MIN, BETA_MAX) : 1;
  return {
    requiredReturnPct: riskFreePct + betaUsed * erpPct,
    riskFreePct,
    erpPct,
    betaRaw: usable ? (raw as number) : null,
    betaUsed,
    betaSource: usable ? "measured" : "assumed-market",
  };
}

// A one-line explanation for the UI. Every number here is either published
// (the SBP rate) or measured (beta) — nothing is assumed except a stated ERP.
export function explainRequiredReturn(r: RequiredReturn): string {
  if (r.betaSource === "assumed-market") {
    return `Required return ${r.requiredReturnPct.toFixed(1)}% = SBP ${r.riskFreePct}% + ${r.erpPct}% equity premium (no beta yet, so market risk is assumed).`;
  }
  return (
    `Required return ${r.requiredReturnPct.toFixed(1)}% = SBP ${r.riskFreePct}% + ` +
    `${r.betaUsed.toFixed(2)} × ${r.erpPct}% equity premium. ` +
    `Beta ${r.betaUsed.toFixed(2)} is this share's own move vs the KSE-100 (measured ${(r.betaRaw as number).toFixed(2)}, ` +
    `adjusted toward the market because thinly-traded PSX shares measure artificially low).`
  );
}
