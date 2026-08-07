// Pakistani withholding tax + real-return arithmetic, in one place.
//
// Different instruments are taxed under DIFFERENT sections, so "after tax"
// means a different haircut per rung of the ladder:
//   - profit on debt (Sec 151): bank savings profit, T-bill/MTB profit, the
//     daily profit of money-market funds' underlying debt. Withheld at source;
//     FINAL tax for most individuals. ATL 15% / non-ATL 35% (editable).
//   - dividends (Sec 150): company dividends AND mutual-fund distributions.
//     ATL 15% / non-ATL 30% (editable).
//   - capital gains (Sec 37A): on disposal of listed securities. 15% flat for
//     post-Jul-2024 acquisitions (editable).
// Rates live in Settings because Finance Acts move them almost yearly; these
// helpers only APPLY the configured rates — they never hardcode a rate.
//
// This module is pure (no fetch, no server-only) so client components can
// import it to render real/after-tax figures beside nominal ones.

export type TaxSettings = {
  filerStatus?: string; // "filer" | "non-filer"
  dividendWhtFiler?: number;
  dividendWhtNonFiler?: number;
  cgtRateFiler?: number;
  cgtRateNonFiler?: number;
  podWhtFiler?: number;
  podWhtNonFiler?: number;
};

export type TaxKind = "profit-on-debt" | "dividend" | "capital-gain";

export function isFiler(s: TaxSettings): boolean {
  return (s.filerStatus ?? "filer") !== "non-filer";
}

// The WHT percentage that applies to this kind of income for this user.
export function whtPct(kind: TaxKind, s: TaxSettings): number {
  const filer = isFiler(s);
  switch (kind) {
    case "profit-on-debt":
      return filer ? s.podWhtFiler ?? 15 : s.podWhtNonFiler ?? 35;
    case "dividend":
      return filer ? s.dividendWhtFiler ?? 15 : s.dividendWhtNonFiler ?? 30;
    case "capital-gain":
      return filer ? s.cgtRateFiler ?? 15 : s.cgtRateNonFiler ?? 20;
  }
}

export function afterTaxPct(nominalPct: number, kind: TaxKind, s: TaxSettings): number {
  return nominalPct * (1 - whtPct(kind, s) / 100);
}

// Fisher real return: (1+nominal)/(1+inflation) − 1. Subtracting inflation
// overstates the real return, and overstates it most exactly when inflation is
// high — which in Pakistan is when the number matters.
export function realPct(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
