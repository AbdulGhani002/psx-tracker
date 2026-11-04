// Checks the buying price after dividends (lib/calculations/portfolio): what
// the shares held earned comes off their cost, what the shares sold earned
// does not, what was paid stays for tax, and total return does not move.
//   npx tsx scripts/test-after-dividends.ts
import { summarisePortfolio } from "../lib/calculations/portfolio";

let passed = 0, failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};
const near = (name: string, got: number, want: number) => eq(name, Math.round(got * 100) / 100, Math.round(want * 100) / 100);

const holding = (symbol: string, extra: Record<string, unknown> = {}) => ({ _id: symbol, symbol, name: symbol, sector: "S", shariaCompliant: false, targetAllocationPercent: 0, ...extra });
const row = (symbol: string, type: string, shares: number, net: number, date: string) => ({ _id: `${symbol}${type}${date}`, symbol, type, shares, pricePerShare: 0, totalAmount: net, fees: 0, netAmount: net, ratio: "", date: new Date(date) });
const buy = (symbol: string, shares: number, price: number, date: string) => row(symbol, "BUY", shares, shares * price, date);
const sell = (symbol: string, shares: number, price: number, date: string) => row(symbol, "SELL", -shares, shares * price, date);
const div = (symbol: string, shares: number, rate: number, date: string) => row(symbol, "DIVIDEND", shares, shares * rate * 0.85, date);
const run = (holdings: unknown[], transactions: unknown[], prices: Array<[string, number]>) => summarisePortfolio({ holdings: holdings as any, transactions: transactions as any, prices: new Map(prices) });

// A share held throughout: the whole dividend comes off.
{
  const s = run([holding("MUREB")], [buy("MUREB", 100, 1000, "2026-01-05"), div("MUREB", 100, 10, "2026-03-10")], [["MUREB", 900]]);
  const p = s.positions[0];
  near("paid stays", p.totalCost, 100_000);
  near("paid a share stays", p.avgCost, 1000);
  near("dividend off the cost", p.netCost, 99_150);
  near("dividend off the price", p.netAvgCost, 991.5);
  near("before dividends stays", p.unrealizedPL, -10_000);
  near("worth less cost after dividends", p.marketValue - p.netCost, p.unrealizedPL + p.heldDividends);
  near("total return counts the dividend once", p.totalReturn, -10_000 + 850);
  near("the summary's cost", s.netCost, 99_150);
  near("the summary's open", s.netUnrealizedPL, -9_150);
  near("the summary keeps what was paid", s.totalCost, 100_000);
  near("the summary keeps the open before dividends", s.unrealizedPL, -10_000);
}

// Most of the shares sold after the dividend: only the shares left keep theirs.
{
  const s = run([holding("PTL")], [buy("PTL", 1000, 50, "2026-01-05"), div("PTL", 1000, 2, "2026-03-10"), sell("PTL", 900, 46, "2026-04-10")], [["PTL", 46]]);
  const p = s.positions[0];
  near("the shares left earned a tenth", p.heldDividends, 170);
  near("the rest went with the shares sold", p.sold.dividends, 1530);
  near("cost of the shares left", p.netCost, 5000 - 170);
  near("price of the shares left", p.netAvgCost, 48.3);
  near("paid a share stays", p.avgCost, 50);
  near("a sale still books what was paid", p.realizedPL, -3600);
  near("all dividends still total", s.dividendsTotal, 1700);
}

// Book closure before a sale, paid after it: the dividend is split the same way.
{
  const s = run([holding("X")], [buy("X", 200, 100, "2026-01-05"), sell("X", 150, 100, "2026-03-01"), div("X", 200, 5, "2026-03-10")], [["X", 100]]);
  near("paid on shares since sold", s.positions[0].heldDividends, 212.5);
  near("cost after that part", s.positions[0].netCost, 5000 - 212.5);
}

// A share sold out takes its dividends with it.
{
  const s = run([holding("A"), holding("B")], [buy("A", 10, 100, "2026-01-05"), div("A", 10, 5, "2026-02-05"), sell("A", 10, 110, "2026-03-05"), buy("B", 10, 100, "2026-01-05")], [["A", 110], ["B", 100]]);
  near("nothing off the shares still held", s.netCost, 1000);
  near("the dividend still totals", s.dividendsTotal, 42.5);
  const a = s.positions.find((p) => p.symbol === "A")!;
  near("no cost left on it", a.netCost, 0);
  eq("no price on no shares", a.netAvgCost, 0);
}

// No price: value and cost stay over the same positions.
{
  const s = run([holding("A"), holding("B")], [buy("A", 10, 100, "2026-01-05"), div("A", 10, 5, "2026-02-05"), buy("B", 10, 100, "2026-01-05"), div("B", 10, 5, "2026-02-05")], [["A", 100]]);
  near("the unpriced name stays out", s.netCost, 1000 - 42.5);
  near("its open with it", s.netUnrealizedPL, 42.5);
}

// A parked name stays out of the portfolio's cost and keeps its own figures.
{
  const s = run([holding("A"), holding("LUCK", { parked: true })], [buy("A", 10, 100, "2026-01-05"), buy("LUCK", 6, 460, "2026-01-05"), div("LUCK", 6, 5, "2026-02-05")], [["A", 100], ["LUCK", 404]]);
  near("parked out of the summary", s.netCost, 1000);
  near("parked keeps its own", s.parked[0].netCost, 2760 - 25.5);
}

// A bonus lowers the price a share; the dividends still come off the total.
{
  const s = run([holding("A")], [buy("A", 100, 100, "2026-01-05"), div("A", 100, 10, "2026-02-05"), row("A", "BONUS", 100, 0, "2026-03-05")], [["A", 60]]);
  near("cost after a bonus", s.positions[0].netCost, 10_000 - 850);
  near("price after a bonus", s.positions[0].netAvgCost, 45.75);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
