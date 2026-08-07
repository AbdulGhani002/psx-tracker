// A missing price must never become a fabricated loss.
//
// Regression test for a real defect: `prices.get(sym) ?? 0` valued an unpriced
// holding at zero, which reported unrealizedPL = -totalCost (a 100% wipeout)
// and silently dropped the position out of totalValue and every weight %.
// Run: npx tsx scripts/test-unpriced.ts

import { buildPositionRows, summarisePortfolio } from "../lib/calculations/portfolio";
import type { Holding, Transaction } from "../lib/types";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? "  " + extra : ""}`);
  }
}

function holding(symbol: string): Holding {
  return {
    symbol,
    name: symbol,
    sector: "Test",
    shariaCompliant: false,
    targetAllocationPercent: 50,
  } as unknown as Holding;
}

function buy(symbol: string, shares: number, price: number): Transaction {
  return {
    symbol,
    type: "BUY",
    date: new Date("2026-01-01"),
    shares,
    price,
    netAmount: shares * price,
    fees: 0,
  } as unknown as Transaction;
}

const holdings = [holding("PRICED"), holding("NOQUOTE")];
const txs = [buy("PRICED", 100, 50), buy("NOQUOTE", 100, 20)];
// PRICED has a quote; NOQUOTE has none at all.
const prices = new Map<string, number>([["PRICED", 60]]);

const rows = buildPositionRows({ holdings, transactions: txs, prices });
const priced = rows.find((r) => r.symbol === "PRICED")!;
const unpriced = rows.find((r) => r.symbol === "NOQUOTE")!;

console.log("the priced position is unaffected");
ok("priceKnown", priced.priceKnown === true);
ok("market value 100 x 60", priced.marketValue === 6000, `${priced.marketValue}`);
ok("gain = 6000 - 5000", priced.unrealizedPL === 1000, `${priced.unrealizedPL}`);

console.log("\nthe unpriced position must NOT invent a wipeout");
ok("flagged as unknown", unpriced.priceKnown === false);
ok("no fabricated -100% loss", unpriced.unrealizedPL === 0, `unrealizedPL=${unpriced.unrealizedPL}`);
ok("no fabricated -100% pct", unpriced.unrealizedPct === 0, `unrealizedPct=${unpriced.unrealizedPct}`);
ok("cost is still remembered", unpriced.totalCost === 2000, `${unpriced.totalCost}`);
// The old behaviour: marketValue 0 -> unrealizedPL -2000. Prove it's gone.
ok("old bug would have said -2000", unpriced.unrealizedPL !== -2000);

console.log("\nportfolio totals compare like with like");
const sum = summarisePortfolio({ holdings, transactions: txs, prices });
ok("unpriced symbol reported", JSON.stringify(sum.unpricedSymbols) === JSON.stringify(["NOQUOTE"]), JSON.stringify(sum.unpricedSymbols));
ok("totalValue = priced only", sum.totalValue === 6000, `${sum.totalValue}`);
ok("totalCost = priced only", sum.totalCost === 5000, `${sum.totalCost}`);
// The bug one layer up: totalCost 7000 - totalValue 6000 => -1000 phantom loss.
ok("unrealizedPL = +1000, not -1000", sum.unrealizedPL === 1000, `${sum.unrealizedPL}`);

console.log("\nweights are computed over what we can actually value");
ok("priced position is 100% of the valued book", priced.currentPercent === 100, `${priced.currentPercent}`);

console.log("\nbanked cash survives a missing quote");
const withDiv: Transaction[] = [
  ...txs,
  { symbol: "NOQUOTE", type: "DIVIDEND", date: new Date("2026-03-01"), shares: 0, price: 0, netAmount: 500, fees: 0 } as unknown as Transaction,
];
const sum2 = summarisePortfolio({ holdings, transactions: withDiv, prices });
ok("dividends still counted for an unpriced holding", sum2.dividendsTotal === 500, `${sum2.dividendsTotal}`);

console.log("\na zero/NaN quote is treated as unknown, not as a real price of 0");
const badPrices = new Map<string, number>([["PRICED", 60], ["NOQUOTE", 0]]);
const badRows = buildPositionRows({ holdings, transactions: txs, prices: badPrices });
const zeroQuoted = badRows.find((r) => r.symbol === "NOQUOTE")!;
ok("price 0 -> unknown", zeroQuoted.priceKnown === false);
ok("price 0 -> no fake loss", zeroQuoted.unrealizedPL === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
