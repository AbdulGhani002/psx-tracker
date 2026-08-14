export type CommodityTradeInput = {
  side: "LONG" | "SHORT";
  lots: number;
  lotSize: number;
  entryPrice: number;
  exitPrice: number | null;
  currentPrice: number | null;
  status: string; // OPEN | CLOSED
  marginPosted?: number;
};

export type TradeValuation = {
  units: number;
  exposure: number; // entry notional
  markPrice: number; // price used for P/L (exit if closed, else current/entry)
  grossPL: number;
  commission: number;
  netPL: number;
  cgt: number; // only on closed, positive net
  netAfterTax: number;
  returnPct: number; // net / exposure — understates a futures result
  // The return a futures trader actually earned: net over the cash posted to
  // hold the position. Null when no margin was recorded, never faked from a
  // guessed margin rate.
  returnOnMarginPct: number | null;
  leverage: number | null; // exposure / margin
  isOpen: boolean;
};

export function valueTrade(
  t: CommodityTradeInput,
  commissionPerLot: number,
  cgtPercent: number
): TradeValuation {
  const isOpen = t.status !== "CLOSED";
  const units = t.lots * t.lotSize;
  const exposure = units * t.entryPrice;
  const markPrice = isOpen
    ? t.currentPrice ?? t.entryPrice
    : t.exitPrice ?? t.entryPrice;
  const dir = t.side === "LONG" ? 1 : -1;
  const grossPL = (markPrice - t.entryPrice) * units * dir;
  const commission = commissionPerLot * t.lots; // round-turn per lot
  const netPL = grossPL - commission;
  // Commodity-futures CGT only crystallises on close, on a positive net gain.
  const cgt = !isOpen && netPL > 0 ? (netPL * cgtPercent) / 100 : 0;
  const netAfterTax = netPL - cgt;
  const margin = t.marginPosted ?? 0;
  return {
    units,
    exposure,
    markPrice,
    grossPL,
    commission,
    netPL,
    cgt,
    netAfterTax,
    returnPct: exposure > 0 ? netPL / exposure : 0,
    returnOnMarginPct: margin > 0 ? netPL / margin : null,
    leverage: margin > 0 ? exposure / margin : null,
    isOpen,
  };
}

export type ExpiryState = "none" | "ok" | "near" | "expired";

export type ExpiryStatus = {
  state: ExpiryState;
  daysToExpiry: number | null;
  // True when an open DELIVERABLE contract is at or past expiry: PMEX settles
  // it by actual delivery of the commodity unless it is squared off first.
  deliveryRisk: boolean;
};

// How urgent an open contract is. Closed contracts are never urgent.
export function expiryStatus(
  t: { status: string; expiryDate?: string | null; contractType?: string },
  todayIso: string,
  nearDays = 7
): ExpiryStatus {
  if (t.status === "CLOSED" || !t.expiryDate) {
    return { state: "none", daysToExpiry: null, deliveryRisk: false };
  }
  const ms =
    new Date(t.expiryDate + "T00:00:00Z").getTime() - new Date(todayIso + "T00:00:00Z").getTime();
  const days = Math.round(ms / 86_400_000);
  const state: ExpiryState = days < 0 ? "expired" : days <= nearDays ? "near" : "ok";
  return {
    state,
    daysToExpiry: days,
    deliveryRisk: days <= 0 && t.contractType === "DELIVERABLE",
  };
}
