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
  // What the money earned, so a parked balance reads as a working one.
  // `accruedDays` is how many days of yield were added on top of the published
  // NAV — zero when the NAV is today's, which is the normal weekday case.
  earnedPerDay: number; // rupees a day at the current balance and yield
  earnedToday: number; // the most recent day's worth
  earnedSinceAnchor: number; // value now less value at the anchor balance
  accruedDays: number;
};

// Daily-dividend / money-market funds (e.g. Alhamra Daily Dividend) keep their
// PUBLISHED NAV pinned at par and pay income as daily dividends. Their profit is
// real but invisible if you just look at NAV. So for these we compute an
// EFFECTIVE NAV that ticks up every day at the fund's annualised yield (par
// compounded daily) — the value and return then reflect the daily income. The
// published par NAV is kept for reference. Growth funds are unchanged.
// `navAsOf` is the date the published NAV belongs to. A money-market fund keeps
// earning on the days MUFAP does not publish — weekends and holidays — so for
// those funds the NAV is carried forward at the fund's own yield until it is
// republished. Without that the balance sits frozen from Friday to Monday and
// looks like the money stopped working, which is the one thing a cash fund is
// supposed to never do. Growth funds that are not money-market are left alone:
// their NAV moves on markets, and inventing a trend for it would be a lie.
export function valueFund(
  fund: {
    units: number;
    avgCost: number;
    dailyDividend?: boolean;
    annualYieldPct?: number;
    anchorDate?: string;
    moneyMarket?: boolean; // carry the NAV forward on non-publishing days
  },
  nav: number,
  asOf: string = new Date().toISOString().slice(0, 10),
  navAsOf?: string
): FundValuation {
  const units = fund.units;
  const isDaily = !!fund.dailyDividend;
  const yieldPct = fund.annualYieldPct ?? 0;
  const par = nav > 0 ? nav : fund.avgCost > 0 ? fund.avgCost : 100;
  const dailyFactor = yieldPct > 0 ? Math.pow(1 + yieldPct / 100, 1 / 365) : 1;

  let effectiveNav = isDaily ? par : nav;
  let dailyYieldPct = 0;
  let accruedDays = 0;

  if (isDaily && fund.anchorDate && yieldPct > 0) {
    // Par-NAV funds pay income as units. Compound from the anchor.
    accruedDays = daysBetween(fund.anchorDate, asOf);
    effectiveNav = par * Math.pow(dailyFactor, accruedDays);
    dailyYieldPct = (dailyFactor - 1) * 100;
  } else if (fund.moneyMarket && nav > 0 && yieldPct > 0) {
    // Growth-class money market: the published NAV already contains the income
    // up to its own date. Only bridge the gap to today.
    accruedDays = navAsOf ? daysBetween(navAsOf, asOf) : 0;
    effectiveNav = nav * Math.pow(dailyFactor, accruedDays);
    dailyYieldPct = (dailyFactor - 1) * 100;
  }

  const usedNav = isDaily || fund.moneyMarket ? effectiveNav : nav;
  const value = units * usedNav;
  const cost = units * fund.avgCost;
  const unrealizedPL = value - cost;

  // A day's worth at the balance as it stands, and the last day actually added.
  const earnedPerDay = dailyYieldPct > 0 ? value - value / dailyFactor : 0;
  const earnedToday = accruedDays > 0 ? earnedPerDay : 0;
  // Value now against the same units at the anchor NAV — the income the units
  // have thrown off since the statement, which is what "my cash grew" means.
  const anchorNav = isDaily ? par : nav;
  const earnedSinceAnchor = units * (usedNav - anchorNav);

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
    earnedPerDay,
    earnedToday,
    earnedSinceAnchor,
    accruedDays,
  };
}
