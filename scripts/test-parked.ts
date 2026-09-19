// Checks that a parked holding stays out of the portfolio figures and keeps
// what it earned (lib/calculations/portfolio).
//   npx tsx scripts/test-parked.ts
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

const holding = (symbol: string, extra: Record<string, unknown> = {}) => ({ _id: symbol, symbol, name: symbol, sector: "S", shariaCompliant: false, currentShares: 0, avgCostBasis: 0, totalCost: 0, realizedPL: 0, totalDividendsReceived: 0, targetAllocationPercent: 0, rebalanceBand: 3, targetRationale: "", notes: "", ...extra }) as any;
const tx = (symbol: string, type: string, shares: number, price: number, date: string) => ({ _id: `${symbol}${type}${date}`, symbol, type, shares, pricePerShare: price, totalAmount: Math.abs(shares) * price, fees: 0, netAmount: Math.abs(shares) * price, date, ratio: "" }) as any;

const holdings = [holding("AHCL", { targetAllocationPercent: 60 }), holding("MEBL", { targetAllocationPercent: 40 }), holding("LUCK", { parked: true, parkedNote: "reports" })];
const transactions = [
  tx("AHCL", "BUY", 1000, 15, "2026-01-05"),
  tx("MEBL", "BUY", 100, 500, "2026-01-05"),
  tx("LUCK", "BUY", 376, 460, "2026-06-17"),
  tx("LUCK", "SELL", -370, 410, "2026-09-15"),
  tx("LUCK", "DIVIDEND", 376, 25, "2026-08-10"),
];
const prices = new Map([["AHCL", 15.1], ["MEBL", 552], ["LUCK", 416]]);
const s = summarisePortfolio({ holdings, transactions, prices });

eq("positions leave the parked name out", s.positions.map((p) => p.symbol), ["AHCL", "MEBL"]);
eq("the parked name is listed on its own", s.parked.map((p) => [p.symbol, p.shares, p.parked]), [["LUCK", 6, true]]);
near("total value counts the portfolio only", s.totalValue, 1000 * 15.1 + 100 * 552);
near("total cost counts the portfolio only", s.totalCost, 15000 + 50000);
near("unrealised gain counts the portfolio only", s.unrealizedPL, 100 + 5200);
near("realised gain of the parked name is kept", s.realizedPL, 370 * 410 - 370 * 460);
near("dividends of the parked name are kept", s.dividendsTotal, 376 * 25);
eq("weights are over the portfolio only", s.positions.map((p) => Math.round(p.currentPercent * 10) / 10), [21.5, 78.5]);
eq("a parked row has no weight", s.parked[0].currentPercent, 0);
eq("sectors count the portfolio only", s.sectorBreakdown.map((x) => Math.round(x.value)), [Math.round(1000 * 15.1 + 100 * 552)]);
near("the parked row is still valued", s.parked[0].marketValue, 6 * 416);

const none = summarisePortfolio({ holdings: holdings.map((h) => ({ ...h, parked: false })), transactions, prices });
eq("nothing parked: all three are positions", none.positions.map((p) => p.symbol), ["AHCL", "MEBL", "LUCK"]);
eq("nothing parked: parked list is empty", none.parked, []);
near("nothing parked: value includes LUCK", none.totalValue, 1000 * 15.1 + 100 * 552 + 6 * 416);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
