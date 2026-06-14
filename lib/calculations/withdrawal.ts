// Income / withdrawal planner — Pakistan-aware FIRE math.
//
// The 4% rule is a *real* (inflation-adjusted) rule built on US assumptions. In
// Pakistan nominal numbers are large but inflation eats most of them, so the
// honest safe withdrawal rate is lower (~3% real). This module computes:
//   • safe vs max monthly income for a given portfolio,
//   • the portfolio needed for a target income,
//   • and a year-by-year depletion simulation for a chosen income-growth rate,
//     which exposes the crossover where a fast-growing withdrawal overruns
//     returns and drains the pot.
//
// Returns are driven by YOUR actual portfolio performance (money-weighted XIRR)
// where available, not a generic market assumption.

export type WithdrawalInputs = {
  portfolio: number; // current value, PKR
  nominalReturnPct: number; // expected annual return %
  inflationPct: number; // expected annual inflation %
  safeRealRatePct?: number; // safe real withdrawal rate; default 3
};

export type WithdrawalResult = {
  realReturnPct: number; // (1+nom)/(1+inf) - 1
  safeMonthly: number; // safe real rate × portfolio / 12 — lasts, rises with inflation
  maxMonthly: number; // full nominal profit / 12 — erodes real capital
  perLakhSafe: number; // safe monthly per 100,000
  perLakhMax: number; // max monthly per 100,000
};

export function realReturn(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

export function computeWithdrawal(i: WithdrawalInputs): WithdrawalResult {
  const safeRate = (i.safeRealRatePct ?? 3) / 100;
  return {
    realReturnPct: realReturn(i.nominalReturnPct, i.inflationPct),
    safeMonthly: (i.portfolio * safeRate) / 12,
    maxMonthly: (i.portfolio * (i.nominalReturnPct / 100)) / 12,
    perLakhSafe: (100000 * safeRate) / 12,
    perLakhMax: (100000 * (i.nominalReturnPct / 100)) / 12,
  };
}

// Portfolio needed to fund a target monthly income at the safe real rate.
export function portfolioForIncome(targetMonthly: number, safeRealRatePct = 3): number {
  if (safeRealRatePct <= 0) return Infinity;
  return (targetMonthly * 12) / (safeRealRatePct / 100);
}

export type SimInputs = {
  portfolio: number;
  nominalReturnPct: number;
  incomeMonthly: number; // year-1 monthly withdrawal
  incomeGrowthPct: number; // how fast the withdrawal grows each year
  years: number; // horizon to simulate
};

export type SimYear = {
  year: number;
  startValue: number;
  withdrawal: number; // annual
  endValue: number;
};

export type SimResult = {
  series: SimYear[];
  peakYear: number; // year the portfolio is largest
  peakValue: number;
  runDryYear: number | null; // first year it hits zero, or null if it survives
  endValue: number;
};

// Each year: withdraw at the start (you need to live on it), the remainder
// compounds at the return, then next year's withdrawal grows.
export function simulateDepletion(i: SimInputs): SimResult {
  let value = i.portfolio;
  let annualIncome = i.incomeMonthly * 12;
  const series: SimYear[] = [];
  let peakValue = value;
  let peakYear = 0;
  let runDryYear: number | null = null;

  for (let y = 1; y <= i.years; y++) {
    const startValue = value;
    const withdrawal = Math.min(annualIncome, Math.max(0, startValue));
    const afterWithdraw = startValue - withdrawal;
    value = afterWithdraw * (1 + i.nominalReturnPct / 100);
    series.push({ year: y, startValue, withdrawal, endValue: value });
    if (value > peakValue) {
      peakValue = value;
      peakYear = y;
    }
    if (value <= 0 && runDryYear == null) {
      runDryYear = y;
      break;
    }
    annualIncome *= 1 + i.incomeGrowthPct / 100;
  }

  return { series, peakYear, peakValue, runDryYear, endValue: value };
}

// A milestone table: portfolio size -> safe & max monthly. Steps in lakhs.
export function milestoneTable(
  nominalReturnPct: number,
  safeRealRatePct = 3,
  sizes: number[] = [1_000_000, 2_500_000, 5_000_000, 7_500_000, 10_000_000, 20_000_000, 30_000_000, 50_000_000, 80_000_000]
): { portfolio: number; safeMonthly: number; maxMonthly: number }[] {
  const safeRate = safeRealRatePct / 100;
  return sizes.map((p) => ({
    portfolio: p,
    safeMonthly: (p * safeRate) / 12,
    maxMonthly: (p * (nominalReturnPct / 100)) / 12,
  }));
}
