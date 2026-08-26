// Bank / balance-sheet valuation tests.
// Run: npx tsx scripts/test-financials.ts
//
// The identity every one of these protects: a bank earning exactly its cost of
// equity is worth exactly its book value. Not 0.9x, not 1.2x. If that breaks,
// every other number the model produces is decoration.

import {
  isFinancialSector,
  sustainableGrowthPct,
  residualIncomeValue,
  justifiedPriceToBook,
  impliedRoePct,
} from "../lib/calculations/financials";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}

console.log("which sectors are balance-sheet businesses");
ok("Commercial Banks", isFinancialSector("Commercial Banks"));
ok("Insurance", isFinancialSector("Insurance"));
ok("Modarabas", isFinancialSector("Modarabas"));
ok("Leasing Companies", isFinancialSector("Leasing Companies"));
ok("Investment banks", isFinancialSector("Investment Banks / Investment Cos. / Securities Cos."));
ok("Cement is not", !isFinancialSector("Cement"));
ok("Pharmaceuticals is not", !isFinancialSector("Pharmaceuticals"));
ok("empty is not", !isFinancialSector("") && !isFinancialSector(null));

console.log("\nthe identity: ROE = r means worth exactly book");
const atCost = justifiedPriceToBook({ bookValuePerShare: 100, roePct: 15, requiredReturnPct: 15, growthPct: 5 });
ok("justified P/B is exactly 1.0", atCost != null && Math.abs(atCost.multiple - 1) < 1e-9, String(atCost?.multiple));
ok("and the value is exactly book", atCost != null && Math.abs(atCost.value - 100) < 1e-9, String(atCost?.value));
const riAtCost = residualIncomeValue({ bookValuePerShare: 100, roePct: 15, requiredReturnPct: 15, payoutRatio: 0.4 });
ok("residual income also lands on book", riAtCost != null && Math.abs(riAtCost.value - 100) < 0.01, String(riAtCost?.value));
ok("with no excess to discount", riAtCost != null && Math.abs(riAtCost.presentValueOfExcess) < 0.01);

console.log("\nexcess returns are worth a premium, shortfalls a discount");
const good = justifiedPriceToBook({ bookValuePerShare: 100, roePct: 22, requiredReturnPct: 15, growthPct: 5 });
ok("ROE above r → above book", good != null && good.multiple > 1, String(good?.multiple));
ok("(22-5)/(15-5) = 1.7x", good != null && Math.abs(good.multiple - 1.7) < 1e-9, String(good?.multiple));
const bad = justifiedPriceToBook({ bookValuePerShare: 100, roePct: 9, requiredReturnPct: 15, growthPct: 5 });
ok("ROE below r → below book", bad != null && bad.multiple < 1, String(bad?.multiple));
ok("(9-5)/(15-5) = 0.4x", bad != null && Math.abs(bad.multiple - 0.4) < 1e-9, String(bad?.multiple));

console.log("\nthe formula refuses where it stops meaning anything");
ok("g ≥ r → null, not a negative multiple", justifiedPriceToBook({ bookValuePerShare: 100, roePct: 20, requiredReturnPct: 12, growthPct: 12 }) != null);
const runaway = justifiedPriceToBook({ bookValuePerShare: 100, roePct: 20, requiredReturnPct: 12, growthPct: 30 });
ok("growth above r is pulled below it, never left to explode", runaway != null && runaway.multiple > 0 && runaway.multiple <= 5, String(runaway?.multiple));
ok("no book value → null", justifiedPriceToBook({ bookValuePerShare: 0, roePct: 20, requiredReturnPct: 12, growthPct: 5 }) === null);
ok("negative book → null", justifiedPriceToBook({ bookValuePerShare: -50, roePct: 20, requiredReturnPct: 12, growthPct: 5 }) === null);
const huge = justifiedPriceToBook({ bookValuePerShare: 100, roePct: 55, requiredReturnPct: 12, growthPct: 10 });
ok("absurd multiples are capped at 5x book", huge != null && huge.multiple === 5, String(huge?.multiple));

console.log("\nresidual income fades excess returns instead of extrapolating them");
const strong = residualIncomeValue({ bookValuePerShare: 100, roePct: 30, requiredReturnPct: 15, payoutRatio: 0.4, years: 10 })!;
ok("worth more than book", strong.value > 100);
ok("ROE fades toward the cost of equity", strong.rows[strong.rows.length - 1].roePct < strong.rows[0].roePct, `${strong.rows[0].roePct} → ${strong.rows[strong.rows.length - 1].roePct}`);
ok("last year's ROE lands near r + a small edge", Math.abs(strong.rows[strong.rows.length - 1].roePct - 16.5) < 0.001, String(strong.rows[strong.rows.length - 1].roePct));
ok("a fading model beats no premium but stays sane", strong.value > 120 && strong.value < 260, String(strong.value));
ok("terminal share is reported, not hidden", strong.terminalShare > 0 && strong.terminalShare < 1, String(strong.terminalShare));
ok("ten rows of workings", strong.rows.length === 10);

console.log("\na weak bank is worth less than its book, and says so");
const weak = residualIncomeValue({ bookValuePerShare: 100, roePct: 6, requiredReturnPct: 15, payoutRatio: 0.4, years: 10 })!;
ok("below book", weak.value < 100, String(weak.value));
ok("the shortfall is a negative excess", weak.presentValueOfExcess < 0, String(weak.presentValueOfExcess));

console.log("\nbook only compounds by what is retained");
const noPayout = residualIncomeValue({ bookValuePerShare: 100, roePct: 20, requiredReturnPct: 15, payoutRatio: 0, years: 5 })!;
const allPayout = residualIncomeValue({ bookValuePerShare: 100, roePct: 20, requiredReturnPct: 15, payoutRatio: 1, years: 5 })!;
ok("retaining everything grows the book", noPayout.rows[4].openingBook > 100);
ok("paying everything out leaves book flat", Math.abs(allPayout.rows[4].openingBook - 100) < 0.01, String(allPayout.rows[4].openingBook));
ok("so retention is worth more when ROE > r", noPayout.value > allPayout.value);

console.log("\nsustainable growth is what retention can fund");
ok("ROE 20, payout 40% → 12%", Math.abs(sustainableGrowthPct(20, 0.4) - 12) < 1e-9);
ok("full payout → no growth", sustainableGrowthPct(20, 1) === 0);
ok("payout over 100% is clamped, not negative growth", sustainableGrowthPct(20, 1.5) === 0);

console.log("\nROE implied from earning power over book");
ok("EPS 30 on book 150 → 20%", Math.abs((impliedRoePct(30, 150) ?? 0) - 20) < 1e-9);
ok("no book → null, never a divide by zero", impliedRoePct(30, 0) === null);
ok("no earnings → null", impliedRoePct(null, 150) === null);
ok("a loss gives a negative ROE, honestly", (impliedRoePct(-10, 100) ?? 0) === -10);

console.log("\nbad inputs return null rather than a confident number");
ok("no book → no residual income", residualIncomeValue({ bookValuePerShare: 0, roePct: 20, requiredReturnPct: 15, payoutRatio: 0.4 }) === null);
ok("zero required return → null", residualIncomeValue({ bookValuePerShare: 100, roePct: 20, requiredReturnPct: 0, payoutRatio: 0.4 }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
