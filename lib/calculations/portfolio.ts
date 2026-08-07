import type { Holding, Transaction } from "@/lib/types";
import { deriveFromTransactions } from "./holding";
import { xirr, type CashFlow } from "./xirr";
import { inSameTaxYear, currentTaxYear } from "@/lib/dates";

export type PositionRow = {
  symbol: string;
  name: string;
  sector: string;
  shariaCompliant: boolean;
  shares: number;
  avgCost: number;
  currentPrice: number;
  // False when we have no price at all for this symbol (never scraped, or every
  // fetch failed). "No price" is NOT "price zero" — see buildPositionRows.
  priceKnown: boolean;
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
  // Symbols we hold shares in but have NO price for. totalValue/totalCost/
  // unrealizedPL exclude these, so a non-empty list means the totals are
  // incomplete — the UI must say so rather than present them as the full picture.
  unpricedSymbols: string[];
  totalValue: number;
  totalCost: number;
  unrealizedPL: number;
  realizedPL: number;
  dividendsTotal: number;
  dividendsYTD: number; // dividends received in the current PK tax year (Jul–Jun)
  taxYearLabel: string; // e.g. "FY25-26"
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
    // A missing price means UNKNOWN, not zero. The old `?? 0` valued the
    // position at nothing, which reported unrealizedPL = −totalCost (a fake
    // 100% loss) and silently dropped the holding out of the portfolio total
    // and every weight %. When we have no price we report no gain/loss and flag
    // it, so the UI can say "price unavailable" instead of inventing a wipeout.
    const quoted = prices.get(h.symbol);
    const priceKnown = quoted != null && Number.isFinite(quoted) && quoted > 0;
    const currentPrice = priceKnown ? (quoted as number) : 0;
    const marketValue = priceKnown ? derived.shares * currentPrice : 0;
    const unrealizedPL = priceKnown ? marketValue - derived.totalCost : 0;
    const unrealizedPct = priceKnown && derived.totalCost > 0 ? unrealizedPL / derived.totalCost : 0;
    // Realised gains and dividends are BANKED — they stay true even with no quote.
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
      priceKnown,
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

  // Compare like with like. An unpriced position contributes 0 to market value,
  // so including its COST here would subtract it straight out of unrealised P/L
  // and invent a loss at the portfolio level — the same bug as the old `?? 0`,
  // one layer up. Value and cost must be summed over the SAME positions; the
  // unpriced ones are reported separately via `unpricedSymbols` so the UI can
  // tell the user their total is incomplete rather than quietly wrong.
  const priced = positions.filter((p) => p.priceKnown);
  const unpricedSymbols = positions.filter((p) => !p.priceKnown && p.shares > 0).map((p) => p.symbol);
  const totalValue = priced.reduce((s, p) => s + p.marketValue, 0);
  const totalCost = priced.reduce((s, p) => s + p.totalCost, 0);
  const unrealizedPL = totalValue - totalCost;
  // Realised gains and dividends are banked cash — count them for every position.
  const realizedPL = positions.reduce((s, p) => s + p.realizedPL, 0);
  const dividendsTotal = positions.reduce((s, p) => s + p.dividendsReceived, 0);

  // Pakistan tax year is July–June, not the calendar year. Sum dividends
  // received within the current FBR tax year so the figure is filing-relevant.
  const now = new Date();
  const taxYear = currentTaxYear();
  const dividendsYTD = transactions
    .filter((t) => t.type === "DIVIDEND" && inSameTaxYear(new Date(t.date), now))
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
    unpricedSymbols,
    totalValue,
    totalCost,
    unrealizedPL,
    realizedPL,
    dividendsTotal,
    dividendsYTD,
    taxYearLabel: taxYear.label,
    xirr: portfolioXirr,
    xirrSpanDays,
    sectorBreakdown,
    shariaBreakdown,
  };
}
