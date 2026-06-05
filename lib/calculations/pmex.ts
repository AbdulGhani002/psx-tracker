export type CommodityTradeInput = {
  side: "LONG" | "SHORT";
  lots: number;
  lotSize: number;
  entryPrice: number;
  exitPrice: number | null;
  currentPrice: number | null;
  status: string; // OPEN | CLOSED
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
  returnPct: number; // net / exposure
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
    isOpen,
  };
}
