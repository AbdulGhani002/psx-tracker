// A share's P/E then and now, and the P/E it has had when the policy rate
// stood near where it stands today. Pure, so scripts/test-strategy-picks.ts
// runs it.
//
// Earnings are put on today's share count (profit after tax over the shares
// now) and prices are the series adjusted for bonuses and splits, so a split
// does not turn into a jump in the P/E: the exchange's page mixes years
// reported before a split with years restated after it. A year's earnings
// count from three months after it ends, when the accounts are out.
//
// The usual P/E at today's rate: the median of its quarter-end readings with
// the policy rate within 2.5 points of today's (4 when that finds fewer than
// three). No line is fitted through rates: shares whose earnings move with
// rates and shares whose do not would bend one slope for all.

export type AnnualRow = { fiscalYear: number; eps: number | null; profitAfterTax: number | null };
export type YearEps = { end: string; eps: number };
export type PePoint = { date: string; pe: number; rate: number | null };

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// The last day of a financial year that ends in `month` (1-12).
export function fiscalEnd(fiscalYear: number, month: number): string {
  return iso(Date.UTC(fiscalYear, month, 0));
}

// Each year's earnings per share on today's share count: profit after tax
// (thousands of rupees, as the exchange's page gives it) over the shares now,
// or the reported EPS when either is missing. Losses are kept, as negatives.
export function epsOnToday(rows: AnnualRow[], sharesNow: number | null, fiscalYearEndMonth: number | null): YearEps[] {
  const m = fiscalYearEndMonth && fiscalYearEndMonth >= 1 && fiscalYearEndMonth <= 12 ? fiscalYearEndMonth : 6;
  return rows
    .map((r) => {
      const eps = sharesNow && sharesNow > 0 && r.profitAfterTax != null && Number.isFinite(r.profitAfterTax) ? (r.profitAfterTax * 1000) / sharesNow : r.eps;
      return eps != null && Number.isFinite(eps) ? { end: fiscalEnd(r.fiscalYear, m), eps } : null;
    })
    .filter((y): y is YearEps => y != null)
    .sort((a, b) => a.end.localeCompare(b.end));
}

// The earnings known on a date: the latest year ended three months or more
// before it.
export function epsKnownOn(years: YearEps[], date: string): number | null {
  const cut = iso(Date.parse(date + "T00:00:00Z") - 91 * DAY);
  for (let i = years.length - 1; i >= 0; i--) if (years[i].end <= cut) return years[i].eps;
  return null;
}

// P/E on each date, from the price then and the earnings known then; a loss
// or a P/E over 100 is left out (no meaningful multiple).
export function peHistory(dates: string[], priceOn: (d: string) => number | null, years: YearEps[], rateOn: (d: string) => number | null): PePoint[] {
  const out: PePoint[] = [];
  for (const d of dates) {
    const p = priceOn(d), e = epsKnownOn(years, d);
    if (p == null || !(p > 0) || e == null || !(e > 0)) continue;
    const pe = p / e;
    if (pe > 0 && pe <= 100) out.push({ date: d, pe, rate: rateOn(d) });
  }
  return out;
}

const median = (v: number[]) => {
  const x = [...v].sort((p, q) => p - q);
  return x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2;
};

export function usualPe(points: PePoint[], rateNow: number | null): number | null {
  if (rateNow == null) return null;
  for (const band of [2.5, 4]) {
    const v = points.filter((p) => p.rate != null && Math.abs(p.rate - rateNow) <= band).map((p) => p.pe);
    if (v.length >= 3) return median(v);
  }
  return null;
}
