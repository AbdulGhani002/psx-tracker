// Your trading, scored as a monthly review asks: of the sales in a period,
// how many made money, the average win and loss (as a % of what the shares
// sold had cost), the average result a sale, and what trading cost against
// the gains. Each sale's result is matched FIFO and is after costs
// (lib/calculations/lots). Pure, so scripts/test-scorecard.ts runs it.

export type SaleResult = { symbol: string; date: string; proceeds: number; cost: number; gain: number };
export type Score = { sales: number; wins: number; winRate: number | null; avgWinPct: number | null; avgLossPct: number | null; perSale: number | null; total: number; fees: number; feesPctOfGains: number | null };

// One sale may use several lots: one result a sale (a share's sales on one day).
export function salesFrom(disposals: Array<{ symbol: string; soldDate: string; proceeds: number; cost: number; gain: number }>): SaleResult[] {
  const by = new Map<string, SaleResult>();
  for (const d of disposals) {
    const k = `${d.symbol}|${d.soldDate}`;
    const s = by.get(k) ?? { symbol: d.symbol, date: d.soldDate, proceeds: 0, cost: 0, gain: 0 };
    s.proceeds += d.proceeds;
    s.cost += d.cost;
    s.gain += d.gain;
    by.set(k, s);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// `fees`: what the period's buys and sales cost in brokerage and charges.
export function scoreOf(sales: SaleResult[], fees: number): Score {
  const wins = sales.filter((s) => s.gain > 0);
  const losses = sales.filter((s) => s.gain <= 0);
  const pct = (s: SaleResult) => (s.cost > 0 ? (s.gain / s.cost) * 100 : 0);
  const gains = wins.reduce((t, s) => t + s.gain, 0);
  return {
    sales: sales.length,
    wins: wins.length,
    winRate: sales.length ? (wins.length / sales.length) * 100 : null,
    avgWinPct: avg(wins.map(pct)),
    avgLossPct: avg(losses.map(pct)),
    perSale: avg(sales.map((s) => s.gain)),
    total: sales.reduce((t, s) => t + s.gain, 0),
    fees,
    feesPctOfGains: gains > 0 ? (fees / gains) * 100 : null,
  };
}

export function scoreMessage(label: string, s: Score): string | null {
  if (s.sales === 0) return null;
  const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
  const rs = (v: number) => `${v >= 0 ? "+" : "−"}Rs ${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
  const parts = [
    `${s.sales} sale${s.sales === 1 ? "" : "s"}, ${s.wins} won (${Math.round(s.winRate ?? 0)}%)`,
    [s.avgWinPct != null ? `average win ${sign(s.avgWinPct)}` : "", s.avgLossPct != null ? `loss ${sign(s.avgLossPct)}` : ""].filter(Boolean).join(", "),
    s.perSale != null ? `${rs(s.perSale)} a sale` : "",
    `costs Rs ${Math.round(s.fees).toLocaleString("en-US")}${s.feesPctOfGains != null ? ` (${Math.round(s.feesPctOfGains)}% of the gains)` : ""}`,
  ].filter(Boolean);
  return `📒 <b>Trading, ${label}</b>: ${parts.join(" · ")}.`;
}
