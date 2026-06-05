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
  nav: number;
  value: number;
  cost: number; // units * avgCost
  unrealizedPL: number;
  unrealizedPct: number;
};

export function valueFund(
  fund: { units: number; avgCost: number },
  nav: number
): FundValuation {
  const value = fund.units * nav;
  const cost = fund.units * fund.avgCost;
  const unrealizedPL = value - cost;
  return {
    units: fund.units,
    nav,
    value,
    cost,
    unrealizedPL,
    unrealizedPct: cost > 0 ? unrealizedPL / cost : 0,
  };
}
