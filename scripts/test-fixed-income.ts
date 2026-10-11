// T-bills and sukuks (lib/fixed-income/value): worth, profit, yield.
//
//   npx tsx scripts/test-fixed-income.ts

import { valueFixedIncome, couponDates, tbillCost, type FixedIncomeHolding } from "../lib/fixed-income/value";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

// A 12-month T-bill of Rs 1m face bought at 11%.
const cost = tbillCost(1_000_000, 11, 365);
const bill: FixedIncomeHolding = { kind: "tbill", name: "12M T-bill", face: 1_000_000, cost, purchaseDate: "2026-01-01", maturityDate: "2027-01-01", couponPct: 0, couponsPerYear: 0, taxPct: 15 };
check("the price for a yield: face over one plus the yield for the days", near(cost, 1_000_000 / 1.11));
const half = valueFixedIncome(bill, "2026-07-02");
check("half way, the discount is half earned", near(half.value, cost + (1_000_000 - cost) * (182 / 365), 1), half.value.toFixed(0));
check("the yield at the price paid is the quoted one", near(half.yieldPct, 11, 1e-6), half.yieldPct);
check("after 15% tax", near(half.afterTaxYieldPct, 9.35, 1e-6));
check("days left and no coupons", half.daysLeft === 183 && half.couponsPaid === 0 && half.nextCouponDate === null && !half.matured);
const done = valueFixedIncome(bill, "2027-02-01");
check("at maturity it is worth its face and has nothing more to pay", done.matured && near(done.value, 1_000_000) && done.atMaturity === 0 && near(done.profitSoFar, 1_000_000 - cost));

// A 5-year GoP Ijara sukuk, 12% paid half-yearly, bought at par at issue.
const sukuk: FixedIncomeHolding = { kind: "sukuk", name: "GoP Ijara 5Y", face: 1_000_000, cost: 1_000_000, purchaseDate: "2026-03-15", maturityDate: "2031-03-15", couponPct: 12, couponsPerYear: 2, taxPct: 15 };
check("coupons fall every six months back from maturity", couponDates(sukuk, sukuk.purchaseDate).slice(0, 3).join() === "2026-09-15,2027-03-15,2027-09-15" && couponDates(sukuk, sukuk.purchaseDate).length === 10);
const s1 = valueFixedIncome(sukuk, "2027-03-15");
check("a year on: two coupons paid, nothing accrued on the coupon day", s1.couponsPaidCount === 2 && near(s1.couponsPaid, 120_000) && near(s1.value, 1_000_000));
const s2 = valueFixedIncome(sukuk, "2027-06-13");
check("between coupons the profit accrues", near(s2.value - 1_000_000, 1_000_000 * 0.12 * (90 / 365), 1) && s2.nextCouponDate === "2027-09-15", (s2.value - 1_000_000).toFixed(0));
check("its yield at par is its rate", near(s2.yieldPct, 12, 0.05), s2.yieldPct.toFixed(3));
check("what is left to collect: face plus the coupons to come", near(s2.atMaturity, 1_000_000 + 8 * 60_000));
const atPrice = valueFixedIncome({ ...sukuk, pricePct: 98.5 }, "2027-06-13");
check("a market price, when entered, sets the worth (plus the accrual)", near(atPrice.value, 985_000 + (s2.value - 1_000_000), 1));
const discount = valueFixedIncome({ ...sukuk, cost: 950_000 }, "2028-09-15");
check("bought at a discount, the worth is pulled to face over the life", discount.value > 950_000 && discount.value < 1_000_000 && discount.yieldPct > 12);

// Month ends: a sukuk maturing on 31 August pays on 28 or 29 February.
check("a month-end coupon date clamps to the shorter month", couponDates({ maturityDate: "2028-08-31", couponsPerYear: 2 }, "2027-01-01").join() === "2027-02-28,2027-08-31,2028-02-29,2028-08-31");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
