// Monthly statement data assembly. Template + types live in ./template (pure).

import { getNetWorth, getPortfolioSummary, getAllTransactions, getEffectiveInflationPct, getAttribution } from "@/lib/data";
import { getRecentDecisions } from "@/lib/data-decisions";
import { realPct } from "@/lib/calculations/pk-tax";
import { getUsdPkr } from "@/lib/fx";
import { statementMonth, type MonthlyStatementData } from "./template";

export { buildStatementTex, statementMonth, type MonthlyStatementData } from "./template";

export async function assembleMonthlyStatement(now = new Date()): Promise<MonthlyStatementData> {
  const month = statementMonth(now);
  const [netWorth, summary, txs, inf, usdPkr, attribution, decisions] = await Promise.all([
    getNetWorth(),
    getPortfolioSummary(),
    getAllTransactions(),
    getEffectiveInflationPct().catch(() => ({ pct: null as number | null })),
    getUsdPkr().catch(() => null),
    getAttribution(30).catch(() => null),
    getRecentDecisions(100).catch(() => []),
  ]);

  const inMonth = (d: Date | string) => {
    const iso = new Date(d).toISOString().slice(0, 10);
    return iso >= month.from && iso <= month.to;
  };

  const dividends = txs
    .filter((t) => t.type === "DIVIDEND" && inMonth(t.date))
    .map((t) => ({ symbol: t.symbol, date: new Date(t.date).toISOString().slice(0, 10), net: t.netAmount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const trades = txs
    .filter((t) => (t.type === "BUY" || t.type === "SELL") && inMonth(t.date))
    .map((t) => ({ date: new Date(t.date).toISOString().slice(0, 10), type: t.type, symbol: t.symbol, shares: Math.abs(t.shares), price: t.pricePerShare }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthDecisions = (decisions as any[])
    .filter((d) => inMonth(d.timestamp))
    .map((d) => ({ date: String(d.timestamp).slice(0, 10), symbol: d.symbol, action: String(d.action).replace(/_/g, " "), rationale: String(d.rationale ?? "").slice(0, 140) }));

  const movers = (attribution?.contributions ?? [])
    .slice(0, 5) // already sorted biggest absolute mover first
    .map((r: any) => ({ symbol: r.symbol, contribution: r.changePkr }));

  const positions = summary.positions
    .filter((p) => p.shares > 0)
    .sort((a, b) => b.marketValue - a.marketValue)
    .map((p) => ({ symbol: p.symbol, shares: p.shares, value: p.marketValue, weightPct: p.currentPercent, priceKnown: p.priceKnown }));

  return {
    monthLabel: month.label,
    monthKey: month.key,
    generatedOn: now.toISOString().slice(0, 10),
    netWorthTotal: netWorth.total,
    equity: netWorth.equity,
    funds: netWorth.funds,
    savingsAndCash: netWorth.savings,
    usdEquivalent: usdPkr ? netWorth.total / usdPkr : null,
    unrealizedPL: summary.unrealizedPL,
    unrealizedPct: summary.totalCost > 0 ? (summary.unrealizedPL / summary.totalCost) * 100 : null,
    xirrPct: summary.xirr != null ? summary.xirr * 100 : null,
    realXirrPct: summary.xirr != null && inf.pct != null ? realPct(summary.xirr * 100, inf.pct) : null,
    inflationPct: inf.pct,
    movers,
    moversPartial: movers.length > 0 && (attribution?.contributions ?? []).some((r: any) => r.partialWindow),
    dividends,
    dividendTotal: dividends.reduce((s, d) => s + d.net, 0),
    trades,
    decisions: monthDecisions,
    positions,
    unpriced: summary.unpricedSymbols,
  };
}

