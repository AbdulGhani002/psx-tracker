// Cash deployment against BUY ZONES, with a permanent reserve left in the fund.
//
// The owner does not hold idle cash: spare money lives in an MCB money-market
// fund and comes out only when a name he has been waiting for trades into its
// band. So the question this answers is not "what is my cash doing" but:
//
//   given the money sitting in the fund, which buy-zone names do I buy today,
//   how many whole shares, how much do I pull out of the fund, and what stays?
//
// A fixed percentage of total investable wealth never leaves the fund. It is
// the reserve — subtracted before anything is deployable, so a buying spree
// cannot quietly spend it.
//
// Sizing comes from target weights, never invented. A name sitting in its buy
// zone with no target weight set is REPORTED, not sized: the app does not get
// to decide how big a position should be.
//
// Pure arithmetic. Whole shares only — PSX does not trade fractions.

export type DeployCandidate = {
  symbol: string;
  price: number; // the price the order would be placed at
  targetPct: number; // target weight of the equity book, 0 = not set
  currentValue: number; // what you already hold in this name, at market
};

export type DeployRow = {
  symbol: string;
  price: number;
  shares: number;
  rupees: number;
  targetPct: number;
  currentValue: number;
  finalValue: number;
  finalPct: number; // weight of the equity book after the buys
};

export type DeployPlan = {
  equityValue: number;
  fundsValue: number;
  brokerCash: number;
  cashLike: number; // fund + brokerage: everything that could be deployed
  totalInvestable: number; // equities + cashLike
  reservePct: number;
  reserveRequired: number; // stays in the fund, always
  deployable: number; // cashLike minus the reserve
  rows: DeployRow[]; // whole-share buys, largest first
  deployed: number;
  brokerCashUsed: number;
  pullFromFunds: number; // redeem this much from the fund
  keptInFunds: number; // what remains in the fund afterwards
  undeployed: number; // deployable that no whole share could absorb
  unsized: string[]; // in the buy zone but no target weight — you must decide
  unpriced: string[]; // in the watchlist but no usable price
  warnings: string[];
};

export type DeployInput = {
  candidates: DeployCandidate[]; // ONLY names currently inside their buy zone
  equityValue: number;
  fundsValue: number;
  brokerCash: number;
  reservePct: number; // e.g. 5
  concentrationCap: number; // e.g. 25
  unpriced?: string[];
};

const MAX_ITERS = 500000;

export function planDeployment({
  candidates,
  equityValue,
  fundsValue,
  brokerCash,
  reservePct,
  concentrationCap,
  unpriced = [],
}: DeployInput): DeployPlan {
  const equity = Math.max(0, num(equityValue));
  const funds = Math.max(0, num(fundsValue));
  const cash = Math.max(0, num(brokerCash));
  const pct = Number.isFinite(reservePct) && reservePct > 0 ? Math.min(100, reservePct) : 0;
  const cap = Number.isFinite(concentrationCap) && concentrationCap > 0 ? concentrationCap : 100;

  const cashLike = funds + cash;
  const totalInvestable = equity + cashLike;
  const reserveRequired = (totalInvestable * pct) / 100;
  const deployable = Math.max(0, cashLike - reserveRequired);

  const warnings: string[] = [];
  const unsized: string[] = [];
  const priced: DeployCandidate[] = [];
  for (const c of candidates) {
    if (!(num(c.price) > 0)) continue; // caller lists these in `unpriced`
    if (!(num(c.targetPct) > 0)) {
      unsized.push(c.symbol);
      continue;
    }
    priced.push({
      ...c,
      price: num(c.price),
      targetPct: num(c.targetPct),
      currentValue: Math.max(0, num(c.currentValue)),
    });
  }

  const rs = (v: number) => Math.round(v).toLocaleString("en-PK");

  // Raised before the early returns below: a name you are watching that just
  // hit its band deserves to be mentioned even when nothing gets bought.
  if (unsized.length > 0) {
    warnings.push(
      `In a buy zone but not sized: ${unsized.join(", ")}. Set a target weight on the Rebalance page and the plan will size ${unsized.length === 1 ? "it" : "them"} next time — a position size is your call, not the app's.`
    );
  }

  const empty = (extra: string[] = []): DeployPlan => ({
    equityValue: equity,
    fundsValue: funds,
    brokerCash: cash,
    cashLike,
    totalInvestable,
    reservePct: pct,
    reserveRequired,
    deployable,
    rows: [],
    deployed: 0,
    brokerCashUsed: 0,
    pullFromFunds: 0,
    keptInFunds: funds,
    undeployed: deployable,
    unsized,
    unpriced: [...unpriced],
    warnings: [...warnings, ...extra],
  });

  if (cashLike > 0 && deployable <= 0) {
    return empty([
      `Your ${pct}% reserve is Rs ${rs(reserveRequired)} and you hold Rs ${rs(cashLike)} in fund and cash — there is nothing above the reserve to deploy.`,
    ]);
  }
  if (priced.length === 0) return empty();

  // Target values measured against the equity book AFTER full deployment —
  // that is the book the weights are meant to describe.
  const projectedBook = equity + deployable;

  // The cap binds against the book as it ACTUALLY ends up, not the book you
  // would have had if every rupee were deployed — and how much is deployed
  // depends on the cap, so the two define each other. Solving the worst case
  // (this name buys, nothing else does) closes the loop exactly:
  //   (current + spend) / (equity + spend) <= cap  =>
  //   spend <= (cap*equity - current) / (1 - cap)
  // Any later buy only grows the book and dilutes this weight further, so a
  // plan that satisfies this can never breach the cap.
  const c = cap / 100;
  const maxSpendUnderCap = (currentValue: number): number => {
    if (c >= 1) return Infinity;
    return Math.max(0, (c * equity - currentValue) / (1 - c));
  };

  const state = priced.map((x) => {
    const targetValue = (x.targetPct / 100) * projectedBook;
    // Room = distance to target, but never past the concentration cap.
    const room = Math.max(0, Math.min(targetValue - x.currentValue, maxSpendUnderCap(x.currentValue)));
    return { c: x, targetValue, room, shares: 0, spend: 0 };
  });

  const totalRoom = state.reduce((s, x) => s + x.room, 0);
  if (totalRoom <= 0) {
    return empty([
      "Every name in a buy zone is already at or above its target weight. Nothing is bought on price alone — raise a target first if the thesis says so.",
    ]);
  }

  // Proportional first pass: each name gets its share of the budget in the
  // ratio of how far it is from target, floored to whole shares.
  let leftover = deployable;
  for (const x of state) {
    if (x.room <= 0) continue;
    const budget = Math.min((deployable * x.room) / totalRoom, x.room, leftover);
    const shares = Math.floor(budget / x.c.price);
    if (shares <= 0) continue;
    x.shares = shares;
    x.spend = shares * x.c.price;
    leftover -= x.spend;
  }

  // Greedy remainder: buy one more share of whichever name would still sit
  // furthest below its target after the buy, while it fits in what is left and
  // stays under the cap. The cap is checked against the book as it stands, so
  // early buys are tested conservatively.
  let guard = 0;
  while (guard++ < MAX_ITERS) {
    let best: (typeof state)[number] | null = null;
    let bestRatio = Infinity;
    const deployedSoFar = state.reduce((s, x) => s + x.spend, 0);
    for (const x of state) {
      const price = x.c.price;
      if (price > leftover + 1e-9) continue;
      const postValue = x.c.currentValue + x.spend + price;
      if (postValue > x.targetValue + 1e-9) continue; // never overshoot target
      const bookAfter = equity + deployedSoFar + price;
      if (bookAfter > 0 && (postValue / bookAfter) * 100 > cap + 1e-9) continue; // cap
      const ratio = postValue / x.targetValue;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = x;
      }
    }
    if (!best) break;
    best.shares += 1;
    best.spend += best.c.price;
    leftover -= best.c.price;
  }

  const rows: DeployRow[] = state
    .filter((x) => x.shares > 0)
    .map((x) => ({
      symbol: x.c.symbol,
      price: x.c.price,
      shares: x.shares,
      rupees: x.spend,
      targetPct: x.c.targetPct,
      currentValue: x.c.currentValue,
      finalValue: x.c.currentValue + x.spend,
      finalPct: 0,
    }))
    .sort((a, b) => b.rupees - a.rupees);

  const deployed = rows.reduce((s, r) => s + r.rupees, 0);
  const finalBook = equity + deployed;
  for (const r of rows) r.finalPct = finalBook > 0 ? (r.finalValue / finalBook) * 100 : 0;

  // Brokerage cash is spent first; only the shortfall is redeemed from the fund.
  const brokerCashUsed = Math.min(cash, deployed);
  const pullFromFunds = Math.max(0, deployed - brokerCashUsed);
  const keptInFunds = funds - pullFromFunds;

  for (const r of rows) {
    if (r.finalPct > cap + 1e-9) {
      warnings.push(`${r.symbol} would be ${r.finalPct.toFixed(1)}% of the equity book — above your ${cap}% cap.`);
    }
  }
  if (keptInFunds < reserveRequired - 1e-6) {
    warnings.push(
      `This plan would leave Rs ${rs(keptInFunds)} in the fund, under your Rs ${rs(reserveRequired)} reserve.`
    );
  }

  return {
    equityValue: equity,
    fundsValue: funds,
    brokerCash: cash,
    cashLike,
    totalInvestable,
    reservePct: pct,
    reserveRequired,
    deployable,
    rows,
    deployed,
    brokerCashUsed,
    pullFromFunds,
    keptInFunds,
    undeployed: Math.max(0, deployable - deployed),
    unsized,
    unpriced: [...unpriced],
    warnings,
  };
}

function num(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
