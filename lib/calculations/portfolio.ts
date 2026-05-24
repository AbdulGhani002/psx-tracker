import type { Holding, Transaction } from "@/lib/types";
import { deriveFromTransactions } from "./holding";
import { xirr, type CashFlow } from "./xirr";

export type PositionRow = {
  symbol: string;
  name: string;
  sector: string;
  shariaCompliant: boolean;
  shares: number;
  avgCost: number;
  currentPrice: number;
  totalCost: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPct: number;
  realizedPL: number;
  dividendsReceived: number;
  totalReturn: number;
  totalReturnPct: number;
  currentPercent: number;
  targetPercent: number;
  deviation: number;
};

export type PortfolioSummary = {
  positions: PositionRow[];
  totalValue: number;
  totalCost: number;
  unrealizedPL: number;
  realizedPL: number;
  dividendsTotal: number;
  dividendsYTD: number;
  xirr: number | null;
  xirrSpanDays: number; // 0 when no flows; UI uses this to suppress XIRR for short windows
  sectorBreakdown: { sector: string; value: number; percent: number }[];
  shariaBreakdown: { compliant: number; nonCompliant: number; compliantPercent: number };
};

export function buildPositionRows({
  holdings,
  transactions,
  prices,
}: {
  holdings: Holding[];
  transactions: Transaction[];
  prices: Map<string, number>;
}): PositionRow[] {
  const rows: PositionRow[] = [];

  for (const h of holdings) {
    const txs = transactions.filter((t) => t.symbol === h.symbol);
    const derived = deriveFromTransactions(txs);
    const currentPrice = prices.get(h.symbol) ?? 0;
    const marketValue = derived.shares * currentPrice;
    const unrealizedPL = marketValue - derived.totalCost;
    const unrealizedPct = derived.totalCost > 0 ? unrealizedPL / derived.totalCost : 0;
    const totalReturn = unrealizedPL + derived.realizedPL + derived.dividendsReceived;
    const totalReturnPct = derived.totalCost > 0 ? totalReturn / derived.totalCost : 0;

    rows.push({
      symbol: h.symbol,
      name: h.name,
      sector: h.sector,
      shariaCompliant: h.shariaCompliant,
      shares: derived.shares,
      avgCost: derived.avgCost,
      currentPrice,
      totalCost: derived.totalCost,
      marketValue,
      unrealizedPL,
      unrealizedPct,
      realizedPL: derived.realizedPL,
      dividendsReceived: derived.dividendsReceived,
      totalReturn,
      totalReturnPct,
      currentPercent: 0,
      targetPercent: h.targetAllocationPercent ?? 0,
      deviation: 0,
    });
  }

  const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
  if (totalValue > 0) {
    for (const r of rows) {
      r.currentPercent = (r.marketValue / totalValue) * 100;
      r.deviation = r.currentPercent - r.targetPercent;
    }
  }

  return rows;
}

export function summarisePortfolio({
  holdings,
  transactions,
  prices,
}: {
  holdings: Holding[];
  transactions: Transaction[];
  prices: Map<string, number>;
}): PortfolioSummary {
  const positions = buildPositionRows({ holdings, transactions, prices });
  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = positions.reduce((s, p) => s + p.totalCost, 0);
  const unrealizedPL = totalValue - totalCost;
  const realizedPL = positions.reduce((s, p) => s + p.realizedPL, 0);
  const dividendsTotal = positions.reduce((s, p) => s + p.dividendsReceived, 0);

  const thisYear = new Date().getFullYear();
  const dividendsYTD = transactions
    .filter((t) => t.type === "DIVIDEND" && new Date(t.date).getFullYear() === thisYear)
    .reduce((s, t) => s + t.netAmount, 0);

  // XIRR construction — buys = outflows, sells/divs = inflows, market value today = final inflow
  const flows: CashFlow[] = [];
  for (const tx of transactions) {
    const date = new Date(tx.date);
    if (tx.type === "BUY" || tx.type === "RIGHT") {
      flows.push({ date, amount: -tx.netAmount });
    } else if (tx.type === "SELL") {
      flows.push({ date, amount: tx.netAmount });
    } else if (tx.type === "DIVIDEND") {
      flows.push({ date, amount: tx.netAmount });
    }
  }
  if (totalValue > 0) flows.push({ date: new Date(), amount: totalValue });
  let portfolioXirr = xirr(flows);
  let xirrSpanDays = 0;
  if (flows.length > 0) {
    const earliest = flows.reduce(
      (min, f) => (f.date < min ? f.date : min),
      flows[0].date
    );
    xirrSpanDays = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24);
  }
  // Annualised return is meaningless on a < 90-day window — the math explodes
  // (e.g. +0.4% over a week annualises to thousands of percent). Hide it.
  // Also drop any absurd value (|XIRR| > 500%) that survived as a numerical
  // artefact in Newton-Raphson.
  if (xirrSpanDays < 90 || (portfolioXirr != null && Math.abs(portfolioXirr) > 5)) {
    portfolioXirr = null;
  }

  const sectorMap = new Map<string, number>();
  for (const p of positions) {
    if (p.marketValue <= 0) continue; // ignore historical 0-share holdings
    sectorMap.set(p.sector, (sectorMap.get(p.sector) ?? 0) + p.marketValue);
  }
  const sectorBreakdown = [...sectorMap.entries()]
    .map(([sector, value]) => ({
      sector,
      value,
      percent: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const compliant = positions.filter((p) => p.shariaCompliant).reduce((s, p) => s + p.marketValue, 0);
  const nonCompliant = totalValue - compliant;
  const shariaBreakdown = {
    compliant,
    nonCompliant,
    compliantPercent: totalValue > 0 ? (compliant / totalValue) * 100 : 0,
  };

  return {
    positions,
    totalValue,
    totalCost,
    unrealizedPL,
    realizedPL,
    dividendsTotal,
    dividendsYTD,
    xirr: portfolioXirr,
    xirrSpanDays,
    sectorBreakdown,
    shariaBreakdown,
  };
}
