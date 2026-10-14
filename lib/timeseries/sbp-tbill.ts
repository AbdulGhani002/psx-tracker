// The 12-month T-bill's cut-off yield at SBP's last auction on or before each
// financial year's first day (1 July), for the Yearly tab: what a 12-month
// bill bought as the year began paid.
//
// HISTORY ONLY: every entry is a real auction result, with where it was
// reported (SBP's own pages refuse this server and the machines we fetch
// from). Never add a guessed or future entry. A year not here takes the rate
// the user sets on the Yearly tab, their July rates on the Strategy page, or
// the policy rate through the year.

export type TbillYearStart = { endYear: number; auction: string; pct: number; source: string };

export const SBP_TBILL12M_YEAR_START: TbillYearStart[] = [
  { endYear: 2025, auction: "2024-06-26", pct: 18.54, source: "Dawn, 27 June 2024" },
  { endYear: 2026, auction: "2025-06-25", pct: 10.9274, source: "Mettis Global, 25 June 2025" },
  { endYear: 2027, auction: "2026-06-23", pct: 11.8381, source: "Mettis Global, 8 July 2026" },
];
