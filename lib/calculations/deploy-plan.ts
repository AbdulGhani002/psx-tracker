// Cash deployment against BUY ZONES, with a permanent reserve left in the fund.
//
// The owner does not hold idle cash: spare money lives in an MCB money-market
// fund and comes out only when a name he has been waiting for trades into its
// band. So the question this answers is not "what is my cash doing" but:
//
//   given this much money, which names do I buy today, how many whole shares,
//   how much comes out of the fund, and what stays?
//
// Zone status does not gate the list, it WEIGHTS it. A name inside its buy band
// is bought at full weight; a name above its band is bought less, tapering with
// distance; a name inside its sell band is not bought at all. That way a
// deployment is never all-or-nothing on one price crossing.
//
// A fixed percentage of total investable wealth never leaves the fund. It is
// the reserve — subtracted before anything is deployable, so a buying spree
// cannot quietly spend it.
//
// Sizing comes from target weights, never invented. A name with no target
// weight set is REPORTED, not sized: the app does not get to decide how big a
// position should be.
//
// Pure arithmetic. Whole shares only — PSX does not trade fractions.

export type DeployCandidate = {
  symbol: string;
  price: number; // the price the order would be placed at
  targetPct: number; // target weight of the equity book, 0 = not set
  currentValue: number; // what you already hold in this name, at market
  zoneFactor: number; // 0..1 from zoneBuyFactor — how hard to buy right now
  zoneReason: string; // plain-language why, shown next to the row
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
  zoneFactor: number;
  zoneReason: string;
};

export type DeployPlan = {
  equityValue: number;
  fundsValue: number;
  brokerCash: number;
  freshCash: number; // money typed in for this run, on top of the fund
  cashLike: number; // fund + brokerage: everything already on hand
  totalInvestable: number; // equities + cashLike
  reservePct: number;
  reserveRequired: number; // stays in the fund, always
  deployable: number; // (cashLike − reserve) + freshCash
  rows: DeployRow[]; // whole-share buys, largest first
  deployed: number;
  brokerCashUsed: number;
  freshCashUsed: number;
  pullFromFunds: number; // redeem this much from the fund
  keptInFunds: number; // what remains in the fund afterwards
  undeployed: number; // deployable that no whole share could absorb
  unsized: string[]; // no target weight and none held — you must decide the size
  // Held at a zero target on purpose: no new buying, exit on your own terms.
  windingDown: string[];
  skipped: Array<{ symbol: string; reason: string }>; // zone factor of zero
  // Money that stayed in the fund because no name was at a price you said you
  // would pay. Not idle by accident: idle on purpose, waiting for a level.
  heldForZones: number;
  unpriced: string[];
  warnings: string[];
};

export type DeployInput = {
  candidates: DeployCandidate[]; // every name worth considering, zone-weighted
  equityValue: number;
  fundsValue: number;
  brokerCash: number;
  reservePct: number; // e.g. 5
  freshCash?: number; // new money for this run; 0 = deploy from the fund only
  unpriced?: string[];
};

const MAX_ITERS = 500000;

export function planDeployment({
  candidates,
  equityValue,
  fundsValue,
  brokerCash,
  reservePct,
  freshCash = 0,
  unpriced = [],
}: DeployInput): DeployPlan {
  const equity = Math.max(0, num(equityValue));
  const funds = Math.max(0, num(fundsValue));
  const cash = Math.max(0, num(brokerCash));
  const fresh = Math.max(0, num(freshCash));
  const pct = Number.isFinite(reservePct) && reservePct > 0 ? Math.min(100, reservePct) : 0;

  const cashLike = funds + cash;
  const totalInvestable = equity + cashLike;
  const reserveRequired = (totalInvestable * pct) / 100;
  const deployable = Math.max(0, cashLike - reserveRequired) + fresh;

  const warnings: string[] = [];
  const unsized: string[] = [];
  const windingDown: string[] = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];
  const priced: DeployCandidate[] = [];
  for (const c of candidates) {
    if (!(num(c.price) > 0)) continue; // caller lists these in `unpriced`
    const factor = Number.isFinite(c.zoneFactor) ? Math.min(1, Math.max(0, c.zoneFactor)) : 0;
    if (factor <= 0) {
      skipped.push({ symbol: c.symbol, reason: c.zoneReason || "zone weight is zero" });
      continue;
    }
    if (!(num(c.targetPct) > 0)) {
      // Two very different things share a zero target. A name you HOLD at zero
      // is a decision already made: no new buying, exit on its own sell price.
      // A name you hold none of is simply unsized and waiting on you.
      if (num(c.currentValue) > 0) windingDown.push(c.symbol);
      else unsized.push(c.symbol);
      continue;
    }
    priced.push({
      ...c,
      price: num(c.price),
      targetPct: num(c.targetPct),
      currentValue: Math.max(0, num(c.currentValue)),
      zoneFactor: factor,
    });
  }

  const rs = (v: number) => Math.round(v).toLocaleString("en-PK");

  // Raised before the early returns below: a name you are watching that just
  // hit its band deserves to be mentioned even when nothing gets bought.
  if (unsized.length > 0) {
    warnings.push(
      `In play but not sized: ${unsized.join(", ")}. Set a target weight on the Rebalance page and the plan will size ${unsized.length === 1 ? "it" : "them"} next time — a position size is your call, not the app's.`
    );
  }
  if (windingDown.length > 0) {
    warnings.push(
      `Winding down, so not bought: ${windingDown.join(", ")}. You hold ${windingDown.length === 1 ? "it" : "them"} at a zero target, which this plan reads as no new money in — the exit is your sell price, not a weight rule.`
    );
  }

  const empty = (extra: string[] = []): DeployPlan => ({
    equityValue: equity,
    fundsValue: funds,
    brokerCash: cash,
    freshCash: fresh,
    cashLike,
    totalInvestable,
    reservePct: pct,
    reserveRequired,
    deployable,
    rows: [],
    deployed: 0,
    brokerCashUsed: 0,
    freshCashUsed: 0,
    pullFromFunds: 0,
    keptInFunds: funds,
    undeployed: deployable,
    heldForZones: skipped.length > 0 ? deployable : 0,
    unsized,
    windingDown,
    skipped,
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

  const state = priced.map((x) => {
    const targetValue = (x.targetPct / 100) * projectedBook;
    // Room = distance to target, scaled by how much this price deserves. A name
    // 15% above its band gets a fraction of the gap, not the whole thing. No
    // single-name cap: the target weight is the only limit on a name's size.
    const rawRoom = Math.max(0, targetValue - x.currentValue);
    const room = rawRoom * x.zoneFactor;
    return { c: x, targetValue, room, allowance: x.currentValue + room, shares: 0, spend: 0 };
  });

  const totalRoom = state.reduce((s, x) => s + x.room, 0);
  if (totalRoom <= 0) {
    return empty([
      "Every name in play is already at or above the weight its price justifies. Nothing is bought on price alone — raise a target first if the thesis says so.",
    ]);
  }

  // Proportional first pass: each name gets its share of the budget in the
  // ratio of its zone-weighted room, floored to whole shares.
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
  // furthest below the allowance its price earns, while it fits in what is left.
  let guard = 0;
  while (guard++ < MAX_ITERS) {
    let best: (typeof state)[number] | null = null;
    let bestRatio = Infinity;
    for (const x of state) {
      const price = x.c.price;
      if (price > leftover + 1e-9) continue;
      const postValue = x.c.currentValue + x.spend + price;
      if (postValue > x.allowance + 1e-9) continue; // never past the earned allowance
      const ratio = x.allowance > 0 ? postValue / x.allowance : Infinity;
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
      zoneFactor: x.c.zoneFactor,
      zoneReason: x.c.zoneReason,
    }))
    .sort((a, b) => b.rupees - a.rupees);

  const deployed = rows.reduce((s, r) => s + r.rupees, 0);
  const finalBook = equity + deployed;
  for (const r of rows) r.finalPct = finalBook > 0 ? (r.finalValue / finalBook) * 100 : 0;

  // New money is spent first, then brokerage cash; the fund is redeemed last
  // because it is the one earning a yield while it waits.
  const freshCashUsed = Math.min(fresh, deployed);
  const brokerCashUsed = Math.min(cash, deployed - freshCashUsed);
  const pullFromFunds = Math.max(0, deployed - freshCashUsed - brokerCashUsed);
  const keptInFunds = funds - pullFromFunds;

  if (keptInFunds < reserveRequired - 1e-6) {
    warnings.push(
      `This plan would leave Rs ${rs(keptInFunds)} in the fund, under your Rs ${rs(reserveRequired)} reserve.`
    );
  }

  return {
    equityValue: equity,
    fundsValue: funds,
    brokerCash: cash,
    freshCash: fresh,
    cashLike,
    totalInvestable,
    reservePct: pct,
    reserveRequired,
    deployable,
    rows,
    deployed,
    brokerCashUsed,
    freshCashUsed,
    pullFromFunds,
    keptInFunds,
    undeployed: Math.max(0, deployable - deployed),
    // Whatever is left over while names are sitting outside their bands is
    // money the rules deliberately kept back.
    heldForZones: skipped.length > 0 ? Math.max(0, deployable - deployed) : 0,
    unsized,
    windingDown,
    skipped,
    unpriced: [...unpriced],
    warnings,
  };
}

function num(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
