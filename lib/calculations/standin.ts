// STAND-INS: holding a place in a sector without holding cash.
//
// The name you want is above the price you decided to pay, but the exposure
// still has to live somewhere, and cash is a decision with its own cost. So you
// buy a peer in the same sector, hold the sector, and swap back when the name
// you actually wanted comes into its band. ABL standing in for MEBL is the
// case this was written for.
//
// Three things follow, and all three are what the app gets wrong without this:
//
//   1. The pair shares ONE target weight. The stand-in is not a position with
//      an opinion of its own; it is occupying the primary's allocation. Judged
//      separately, the app would call the stand-in unsized and the primary
//      permanently underweight, and would keep telling you to buy a share you
//      have already decided is too expensive.
//   2. While the primary is out of its band the money goes to the stand-in.
//   3. When the primary enters its band the position REVERSES: sell the
//      stand-in, buy the primary with what it returns. That moment is a
//      decision, so it is surfaced with its arithmetic rather than executed.
//
// A stand-in is a placeholder, not a thesis. Nothing here decides that a peer
// is a good substitute — you choose it, this only keeps the accounting honest.
//
// Pure arithmetic. Whole shares only.

// Commission 0.15% plus 15% SST on the commission, which is what the broker
// actually charges on this account (proven against every stored row). Passed
// as a rate so a different broker is a parameter, not an edit.
export const DEFAULT_FEE_RATE = 0.0015 * 1.15; // 0.001725 of trade value

export type StandInLeg = {
  symbol: string;
  sector: string;
  price: number | null; // null = no usable quote; nothing is sized off it
  shares: number;
  marketValue: number;
  targetPct: number; // only the PRIMARY carries a target
};

export type SwapPlan = {
  sellShares: number;
  sellPrice: number;
  proceeds: number;
  sellFees: number;
  gain: number | null; // null when the lots could not be matched
  cgt: number | null;
  netFromSale: number;
  buyPrice: number;
  buyShares: number;
  buyCost: number;
  buyFees: number;
  totalOutlay: number;
  leftover: number; // cash the swap cannot place in a whole share
  shortfall: number; // what the sale does not cover of a full target buy
};

export type StandInGroup = {
  primary: string;
  standIn: string;
  sectorMatches: boolean;
  primaryValue: number;
  standInValue: number;
  combinedValue: number;
  targetPct: number;
  targetValue: number; // the pair's share of the book
  gapToTarget: number; // still to fill, across the pair
  swapReady: boolean; // the primary is in its buy band
  swap: SwapPlan | null;
  warnings: string[];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// What selling the whole stand-in buys of the primary. Sized on what actually
// reaches the account: proceeds less brokerage and less the CGT the sale
// realises. Tax is not netted off later — it is money that does not arrive.
export function planSwap(args: {
  standInShares: number;
  standInPrice: number;
  primaryPrice: number;
  gain?: number | null; // realised gain on the stand-in lots, when known
  cgtRatePct?: number;
  feeRate?: number;
  targetValue?: number; // the pair's target, to report any shortfall
}): SwapPlan | null {
  const feeRate = args.feeRate ?? DEFAULT_FEE_RATE;
  const sellShares = Math.floor(num(args.standInShares));
  const sellPrice = num(args.standInPrice);
  const buyPrice = num(args.primaryPrice);
  if (sellShares <= 0 || sellPrice <= 0 || buyPrice <= 0) return null;

  const proceeds = r2(sellShares * sellPrice);
  const sellFees = r2(proceeds * feeRate);
  // A realised gain cannot exceed the proceeds — that would need a negative
  // cost basis. Capping it keeps a bad input from taxing the sale into a
  // negative payout and inventing a swap that could never settle.
  const gain = args.gain == null ? null : Math.min(args.gain, proceeds);
  const cgt = gain == null ? null : r2(Math.max(0, gain) * ((args.cgtRatePct ?? 0) / 100));
  const netFromSale = r2(proceeds - sellFees - (cgt ?? 0));

  // Whole shares, with room left for the buy-side brokerage.
  const buyShares = Math.max(0, Math.floor(netFromSale / (buyPrice * (1 + feeRate))));
  const buyCost = r2(buyShares * buyPrice);
  const buyFees = r2(buyCost * feeRate);
  const totalOutlay = r2(buyCost + buyFees);

  const targetValue = num(args.targetValue);
  return {
    sellShares,
    sellPrice,
    proceeds,
    sellFees,
    gain,
    cgt,
    netFromSale,
    buyPrice,
    buyShares,
    buyCost,
    buyFees,
    totalOutlay,
    leftover: r2(netFromSale - totalOutlay),
    shortfall: targetValue > 0 ? Math.max(0, r2(targetValue - buyCost)) : 0,
  };
}

export function resolveStandIn(args: {
  primary: StandInLeg;
  standIn: StandInLeg;
  primaryInBuyZone: boolean;
  bookValue: number; // equity book the target percentage is measured against
  gain?: number | null;
  cgtRatePct?: number;
  feeRate?: number;
}): StandInGroup {
  const { primary, standIn } = args;
  const warnings: string[] = [];

  const sectorMatches =
    !!primary.sector && !!standIn.sector && primary.sector.trim().toLowerCase() === standIn.sector.trim().toLowerCase();
  if (!sectorMatches) {
    warnings.push(
      `${standIn.symbol} (${standIn.sector || "sector unknown"}) is standing in for ${primary.symbol} (${
        primary.sector || "sector unknown"
      }) — different sectors, so it is not the exposure you are holding a place for.`
    );
  }
  if (primary.symbol === standIn.symbol) {
    warnings.push(`${primary.symbol} cannot stand in for itself.`);
  }
  if (standIn.targetPct > 0) {
    warnings.push(
      `${standIn.symbol} carries its own ${standIn.targetPct}% target as well as standing in for ${primary.symbol}. One of the two is double-counting the allocation — clear the stand-in target.`
    );
  }
  if (primary.targetPct <= 0) {
    warnings.push(
      `${primary.symbol} has no target weight, so the pair has no allocation to fill. Set one and the stand-in will be sized against it.`
    );
  }

  const primaryValue = Math.max(0, num(primary.marketValue));
  const standInValue = Math.max(0, num(standIn.marketValue));
  const combinedValue = r2(primaryValue + standInValue);
  const targetValue = r2((num(primary.targetPct) / 100) * Math.max(0, num(args.bookValue)));
  const gapToTarget = r2(Math.max(0, targetValue - combinedValue));

  const swapReady = args.primaryInBuyZone === true && standIn.shares > 0;
  const swap =
    swapReady && standIn.price != null && primary.price != null
      ? planSwap({
          standInShares: standIn.shares,
          standInPrice: standIn.price,
          primaryPrice: primary.price,
          gain: args.gain ?? null,
          cgtRatePct: args.cgtRatePct,
          feeRate: args.feeRate,
          targetValue,
        })
      : null;

  if (swapReady && swap == null) {
    warnings.push(
      `${primary.symbol} is in its buy band but the swap cannot be sized — a live price is missing for ${
        primary.price == null ? primary.symbol : standIn.symbol
      }.`
    );
  }

  return {
    primary: primary.symbol,
    standIn: standIn.symbol,
    sectorMatches,
    primaryValue,
    standInValue,
    combinedValue,
    targetPct: num(primary.targetPct),
    targetValue,
    gapToTarget,
    swapReady,
    swap,
    warnings,
  };
}

// Reject link sets that cannot mean anything before they reach the allocator:
// a chain (A stands in for B which stands in for C), a cycle, or two stand-ins
// competing for one primary. Each is a config mistake that would otherwise
// silently double-count an allocation.
export function validateLinks(links: Array<{ standIn: string; primary: string }>): string[] {
  const problems: string[] = [];
  const byStandIn = new Map<string, string>();
  const primaries = new Set<string>();
  const seenPrimary = new Map<string, string>();

  for (const l of links) {
    const s = l.standIn.toUpperCase();
    const p = l.primary.toUpperCase();
    if (s === p) {
      problems.push(`${s} cannot stand in for itself.`);
      continue;
    }
    if (byStandIn.has(s)) {
      problems.push(`${s} is set to stand in for both ${byStandIn.get(s)} and ${p}. It can only hold one place.`);
      continue;
    }
    if (seenPrimary.has(p)) {
      problems.push(`${p} already has ${seenPrimary.get(p)} standing in for it; ${s} would double-count the allocation.`);
      continue;
    }
    byStandIn.set(s, p);
    seenPrimary.set(p, s);
    primaries.add(p);
  }
  for (const [s, p] of byStandIn) {
    if (byStandIn.has(p)) {
      problems.push(`${s} stands in for ${p}, which is itself standing in for ${byStandIn.get(p)}. Chains are not allowed.`);
    }
    if (primaries.has(s)) {
      problems.push(`${s} is both a stand-in and a primary. Pick one role for it.`);
    }
  }
  return [...new Set(problems)];
}
