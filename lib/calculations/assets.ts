// Valuation for non-PSX assets: profit-bearing savings (daily accrual) and
// mutual funds (units x NAV).

export type SavingsMovement = { date: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number };

export type SavingsValuation = {
  balance: number; // accrued to `asOf`
  principal: number; // anchor + net deposits (no profit)
  profit: number; // balance - principal
  netDeposits: number; // deposits - withdrawals since anchor
};

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// Compound the anchor balance daily at the annual rate, applying movements on
// their dates, up to `asOf` (default today).
export function valueSavings(
  account: {
    ratePercent: number;
    anchorDate: string;
    anchorBalance: number;
    movements: SavingsMovement[];
  },
  asOf: string = new Date().toISOString().slice(0, 10)
): SavingsValuation {
  const dailyFactor = Math.pow(1 + account.ratePercent / 100, 1 / 365);
  const events = [...account.movements]
    .filter((m) => m.date >= account.anchorDate && m.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));

  let bal = account.anchorBalance;
  let cursor = account.anchorDate;
  let netDeposits = 0;

  for (const ev of events) {
    bal *= Math.pow(dailyFactor, daysBetween(cursor, ev.date));
    const signed = ev.type === "DEPOSIT" ? ev.amount : -ev.amount;
    bal += signed;
    netDeposits += signed;
    cursor = ev.date;
  }
  bal *= Math.pow(dailyFactor, daysBetween(cursor, asOf));

  const principal = account.anchorBalance + netDeposits;
  return {
    balance: bal,
    principal,
    profit: bal - principal,
    netDeposits,
  };
}

export type FundValuation = {
  units: number;
  nav: number; // the published (par) NAV
  effectiveNav: number; // total-return NAV: par compounded by the daily yield
  dailyYieldPct: number; // the daily rate the effective NAV grows by
  value: number;
  cost: number;
  unrealizedPL: number;
  unrealizedPct: number;
  dailyDividend: boolean;
};

// Daily-dividend / money-market funds (e.g. Alhamra Daily Dividend) keep their
// PUBLISHED NAV pinned at par and pay income as daily dividends. Their profit is
// real but invisible if you just look at NAV. So for these we compute an
// EFFECTIVE NAV that ticks up every day at the fund's annualised yield (par
// compounded daily) — the value and return then reflect the daily income. The
// published par NAV is kept for reference. Growth funds are unchanged.
export function valueFund(
  fund: {
    units: number;
    avgCost: number;
    dailyDividend?: boolean;
    annualYieldPct?: number;
    anchorDate?: string;
  },
  nav: number,
  asOf: string = new Date().toISOString().slice(0, 10)
): FundValuation {
  const units = fund.units;
  const isDaily = !!fund.dailyDividend;
  const par = nav > 0 ? nav : fund.avgCost > 0 ? fund.avgCost : 100;

  let effectiveNav = isDaily ? par : nav;
  let dailyYieldPct = 0;
  if (isDaily && fund.anchorDate && (fund.annualYieldPct ?? 0) > 0) {
    const days = daysBetween(fund.anchorDate, asOf);
    // Effective-annual convention (same as savings): 17% means +17% over a year.
    const dailyFactor = Math.pow(1 + (fund.annualYieldPct as number) / 100, 1 / 365);
    effectiveNav = par * Math.pow(dailyFactor, days);
    dailyYieldPct = (dailyFactor - 1) * 100;
  }

  const usedNav = isDaily ? effectiveNav : nav;
  const value = units * usedNav;
  const cost = units * fund.avgCost;
  const unrealizedPL = value - cost;
  return {
    units,
    nav,
    effectiveNav,
    dailyYieldPct,
    value,
    cost,
    unrealizedPL,
    unrealizedPct: cost > 0 ? unrealizedPL / cost : 0,
    dailyDividend: isDaily,
  };
}
