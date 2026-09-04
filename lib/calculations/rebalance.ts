import type { PositionRow } from "./portfolio";

export type RebalanceSuggestion = {
  symbol: string;
  sector: string;
  currentValue: number;
  targetValue: number;
  currentPct: number;
  targetPct: number;
  livePrice: number;
  orderPrice: number;
  deltaShares: number;
  actionRupees: number;
  // WIND_DOWN is a position you hold and deliberately target at zero: no new
  // buying, but the exit is governed by your own sell price, not by weight.
  // Without it, "rebalance to target" reads a zero weight as "sell the lot at
  // market today", which is a different instruction entirely.
  action: "BUY" | "SELL" | "HOLD" | "WIND_DOWN";
  windingDown: boolean;
  finalValue: number;
  finalPct: number;
};

export type RebalanceResult = {
  rows: RebalanceSuggestion[];
  cashIn: number;
  deployed: number;
  released: number;
  cashAfter: number;
  leftoverDeployed: number;
  warnings: string[];
};

export type RebalanceInput = {
  positions: PositionRow[];
  freshCash: number;
  cashFromBalance: number;
  totalValue: number;
  allowSelling: boolean;
  orderPrices: Record<string, number | "">;
  redistribute: boolean;
  concentrationCap?: number;
};

export function computeRebalance({
  positions,
  freshCash,
  cashFromBalance,
  totalValue,
  allowSelling,
  orderPrices,
  redistribute,
  concentrationCap = 25,
}: RebalanceInput): RebalanceResult {
  const cashIn = Math.max(0, freshCash) + Math.max(0, cashFromBalance);
  const targetTotal = totalValue + cashIn;

  const priceOf = (p: PositionRow): number => {
    const o = orderPrices[p.symbol];
    // Guard against NaN/Infinity from a malformed input — fall back to live.
    return typeof o === "number" && Number.isFinite(o) && o > 0 ? o : p.currentPrice;
  };

  const rows: RebalanceSuggestion[] = positions.map((p) => {
    const orderPrice = priceOf(p);
    const targetValue = (p.targetPercent / 100) * targetTotal;

    // A zero target on something you already own means it is out of the
    // allocation, not up for sale this morning. It is excluded from buying,
    // and it is NOT forced out at market: it leaves when its own sell price is
    // hit. Selling on a weight rule would dump a position at whatever the
    // screen happens to say today, which is the opposite of having a plan.
    const windingDown = p.targetPercent <= 0 && p.marketValue > 0;

    let deltaRs = windingDown ? 0 : targetValue - p.marketValue;
    if (!allowSelling && deltaRs < 0) deltaRs = 0;

    let deltaShares = 0;
    let actionRupees = 0;
    if (orderPrice > 0 && deltaRs !== 0) {
      if (deltaRs > 0) {
        deltaShares = Math.floor(deltaRs / orderPrice);
        actionRupees = deltaShares * orderPrice;
      } else {
        deltaShares = -Math.floor(Math.abs(deltaRs) / orderPrice);
        actionRupees = deltaShares * orderPrice;
      }
    }

    return {
      symbol: p.symbol,
      sector: p.sector,
      currentValue: p.marketValue,
      targetValue,
      currentPct: p.currentPercent,
      targetPct: p.targetPercent,
      livePrice: p.currentPrice,
      orderPrice,
      deltaShares,
      actionRupees,
      action: "HOLD",
      windingDown,
      finalValue: p.marketValue,
      finalPct: 0,
    };
  });

  // Scale buys to fit the budget (cash + sell proceeds if selling is allowed).
  const totalBuyTarget = rows
    .filter((r) => r.actionRupees > 0)
    .reduce((s, r) => s + r.actionRupees, 0);
  const totalSell = rows
    .filter((r) => r.actionRupees < 0)
    .reduce((s, r) => s + Math.abs(r.actionRupees), 0);
  const availableForBuy = cashIn + (allowSelling ? totalSell : 0);

  if (totalBuyTarget > availableForBuy && totalBuyTarget > 0) {
    const scale = availableForBuy / totalBuyTarget;
    for (const r of rows) {
      if (r.actionRupees > 0 && r.orderPrice > 0) {
        const newShares = Math.floor((r.actionRupees * scale) / r.orderPrice);
        r.deltaShares = newShares;
        r.actionRupees = newShares * r.orderPrice;
      }
    }
  }

  let deployed = rows.filter((r) => r.actionRupees > 0).reduce((s, r) => s + r.actionRupees, 0);
  const released = rows.filter((r) => r.actionRupees < 0).reduce((s, r) => s + Math.abs(r.actionRupees), 0);
  let leftover = cashIn + released - deployed;
  let leftoverDeployed = 0;

  // Greedy leftover deployment. Each iteration buys ONE share of whichever
  // target-weighted position would, after the buy, sit closest to its target
  // weight — i.e. minimise post-buy (value / targetValue). While a position is
  // underweight this ratio is < 1, so underweight names fill first; once all
  // are at target it picks the least-overshooting name, so leftover keeps
  // deploying (the user's explicit ask) while staying as proportional as
  // integer shares allow. Only positions with a target > 0 are eligible.
  // Termination: cash strictly drops by orderPrice (> 0) each buy; bounded by
  // MAX_ITERS as a hard backstop.
  if (redistribute && leftover > 0) {
    const valueOf = new Map(rows.map((r) => [r.symbol, r.currentValue + r.actionRupees]));
    const MAX_ITERS = 500000;
    let guard = 0;
    while (guard++ < MAX_ITERS) {
      let best: RebalanceSuggestion | null = null;
      let bestRatio = Infinity;
      for (const r of rows) {
        if (r.orderPrice <= 0 || r.orderPrice > leftover + 1e-9) continue;
        if (r.targetPct <= 0) continue;
        const tv = (r.targetPct / 100) * targetTotal;
        if (tv <= 0) continue;
        const postBuyRatio = ((valueOf.get(r.symbol) ?? r.currentValue) + r.orderPrice) / tv;
        if (postBuyRatio < bestRatio) {
          bestRatio = postBuyRatio;
          best = r;
        }
      }
      if (!best) break;
      best.deltaShares += 1;
      best.actionRupees += best.orderPrice;
      valueOf.set(best.symbol, (valueOf.get(best.symbol) ?? 0) + best.orderPrice);
      leftover -= best.orderPrice;
      leftoverDeployed += best.orderPrice;
    }
    deployed = rows.filter((r) => r.actionRupees > 0).reduce((s, r) => s + r.actionRupees, 0);
  }

  const cashAfter = cashIn + released - deployed;

  for (const r of rows) {
    r.action = r.windingDown
      ? "WIND_DOWN"
      : r.actionRupees > 0
      ? "BUY"
      : r.actionRupees < 0
      ? "SELL"
      : "HOLD";
    r.finalValue = r.currentValue + r.actionRupees;
  }
  const finalTotal = rows.reduce((s, r) => s + r.finalValue, 0);
  for (const r of rows) {
    r.finalPct = finalTotal > 0 ? (r.finalValue / finalTotal) * 100 : 0;
  }

  const warnings: string[] = [];
  for (const r of rows) {
    if (r.finalPct > concentrationCap) {
      warnings.push(
        `${r.symbol} would be ${r.finalPct.toFixed(1)}% of the portfolio — above your ${concentrationCap}% concentration cap.`
      );
    }
    if (r.livePrice > 0 && r.orderPrice > r.livePrice * 1.0001) {
      warnings.push(
        `${r.symbol} order price is above the live quote — a limit buy may not fill until the market rises.`
      );
    }
  }

  return { rows, cashIn, deployed, released, cashAfter, leftoverDeployed, warnings };
}
