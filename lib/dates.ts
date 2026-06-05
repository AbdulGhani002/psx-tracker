// Pakistan (FBR) tax year runs 1 July → 30 June, and is named by the year in
// which it ENDS. So 1 Jul 2025 – 30 Jun 2026 is "Tax Year 2026" (FY25-26).

export type PkTaxYear = {
  startYear: number; // calendar year the tax year starts (July)
  endYear: number; // calendar year it ends (June) — the FBR "Tax Year"
  label: string; // e.g. "FY25-26"
  fbrName: string; // e.g. "Tax Year 2026"
};

export function taxYearOf(date: Date | string): PkTaxYear {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = d.getMonth(); // 0=Jan … 6=Jul
  const startYear = month >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  const label = `FY${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
  return { startYear, endYear, label, fbrName: `Tax Year ${endYear}` };
}

export function inSameTaxYear(a: Date | string, b: Date | string): boolean {
  return taxYearOf(a).endYear === taxYearOf(b).endYear;
}

export function currentTaxYear(): PkTaxYear {
  return taxYearOf(new Date());
}
