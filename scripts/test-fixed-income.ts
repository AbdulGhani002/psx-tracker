// T-bills and sukuks (lib/fixed-income/value): worth, profit, yield.
//
//   npx tsx scripts/test-fixed-income.ts

import { valueFixedIncome, couponDates, tbillCost, fixedIncomeEvents, depositFace, type FixedIncomeHolding } from "../lib/fixed-income/value";
import { nextTerm, parseAlfaTermRates, profitAtMaturity, rolledMessage, sheetDate, termMonths } from "../lib/fixed-income/rollover";

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

// What each pays and when, with the tax on it (the income calendar and the
// tax by year read these).
const billEvents = fixedIncomeEvents(bill);
check("a T-bill pays once, its discount at maturity, taxed", billEvents.length === 1 && billEvents[0].what === "maturity" && billEvents[0].date === "2027-01-01" && near(billEvents[0].gross, 1_000_000 - cost) && near(billEvents[0].tax, (1_000_000 - cost) * 0.15));
const sukukEvents = fixedIncomeEvents(sukuk);
check("a sukuk at par: ten coupons of Rs 60,000, Rs 9,000 tax each, nothing more at maturity", sukukEvents.length === 10 && sukukEvents.every((e) => e.what === "coupon" && near(e.gross, 60_000) && near(e.tax, 9_000)) && sukukEvents[9].date === "2031-03-15");
const discountEvents = fixedIncomeEvents({ ...sukuk, cost: 950_000 });
check("bought at a discount, the Rs 50,000 back over the price comes at maturity", discountEvents.length === 11 && discountEvents[10].what === "maturity" && near(discountEvents[10].gross, 50_000));
check("bought at a premium, no maturity profit", fixedIncomeEvents({ ...sukuk, cost: 1_020_000 }).every((e) => e.what === "coupon"));

// --- fixed deposits ----------------------------------------------------------
check("a deposit paying its profit as it goes repays its principal", depositFace(1_000_000, 12, "2026-01-15", "2027-01-15", 12) === 1_000_000);
check("one paying at maturity repays the principal plus the simple profit", depositFace(1_000_000, 12, "2026-01-15", "2027-01-15", 0) === 1_120_000 && depositFace(500_000, 10.5, "2026-10-11", "2027-01-11", 0) === Math.round(500_000 * (1 + 0.105 * 92 / 365) * 100) / 100);
const monthly: FixedIncomeHolding = { kind: "fd", name: "Meezan Bank FD", face: 1_000_000, cost: 1_000_000, purchaseDate: "2026-01-15", maturityDate: "2027-01-15", couponPct: 12, couponsPerYear: 12, taxPct: 15 };
const m1 = valueFixedIncome(monthly, "2026-03-01");
check("monthly profit: one month paid, two weeks accrued, worth the principal and the accrual", near(m1.couponsPaid, 10_000) && m1.couponsPaidCount === 1 && near(m1.value, 1_000_000 + (1_000_000 * 0.12 * 14) / 365) && m1.nextCouponDate === "2026-03-15", m1);
check("its yield is its rate, before and after tax", near(m1.yieldPct, 12) && near(m1.afterTaxYieldPct, 10.2));
const mEv = fixedIncomeEvents(monthly);
check("twelve monthly payments, tax withheld on each, no maturity profit", mEv.length === 12 && mEv.every((e) => e.what === "coupon" && near(e.gross, 10_000) && near(e.tax, 1_500)) && mEv[0].date === "2026-02-15" && mEv[11].date === "2027-01-15");
const atEnd: FixedIncomeHolding = { ...monthly, couponsPerYear: 0, face: depositFace(1_000_000, 12, "2026-01-15", "2027-01-15", 0) };
const a1 = valueFixedIncome(atEnd, "2026-07-16");
check("profit at maturity: the worth grows from the principal in a straight line", near(a1.value, 1_000_000 + (120_000 * 182) / 365) && a1.couponsPaid === 0 && near(a1.yieldPct, 12) && a1.atMaturity === 1_120_000, a1);
const aEv = fixedIncomeEvents(atEnd);
check("and pays it all at maturity, taxed once", aEv.length === 1 && aEv[0].what === "maturity" && aEv[0].date === "2027-01-15" && near(aEv[0].gross, 120_000) && near(aEv[0].tax, 18_000));
check("matured: worth what it repaid", valueFixedIncome(atEnd, "2027-02-01").value === 1_120_000 && valueFixedIncome(atEnd, "2027-02-01").matured);

// Deposits that roll over (lib/fixed-income/rollover).
const td: FixedIncomeHolding = { kind: "fd", name: "Bank Alfalah FD", face: depositFace(10000, 10.15, "2026-10-12", "2027-01-12", 0), cost: 10000, purchaseDate: "2026-10-12", maturityDate: "2027-01-12", couponPct: 10.15, couponsPerYear: 0, taxPct: 15 };
check("a 3-month term is 3 whole months; 92 days is not", termMonths("2026-10-12", "2027-01-12") === 3 && termMonths("2026-10-30", "2027-01-30") === 3 && termMonths("2026-10-12", "2027-01-11") === null);
const allIn = nextTerm(td, "all", 10.15);
check("principal + profit: the next term on the profit after tax, from the old maturity, same length", allIn.purchaseDate === "2027-01-12" && allIn.maturityDate === "2027-04-12" && near(allIn.cost, 10000 + (td.face - 10000) * 0.85) && near(allIn.face, depositFace(allIn.cost, 10.15, "2027-01-12", "2027-04-12", 0)), allIn);
const principalOnly = nextTerm(td, "principal", 10.65);
check("principal only: the same principal, at the new rate", principalOnly.cost === 10000 && principalOnly.couponPct === 10.65 && near(principalOnly.face, depositFace(10000, 10.65, "2027-01-12", "2027-04-12", 0)), principalOnly);
const quarterly: FixedIncomeHolding = { kind: "fd", name: "Bank Alfalah FD", face: 15000, cost: 15000, purchaseDate: "2026-10-18", maturityDate: "2027-01-18", couponPct: 10.13, couponsPerYear: 4, taxPct: 15 };
const q2 = nextTerm(quarterly, "all", 10.15);
check("a deposit paying quarterly over 3 months: its one payment rolls in, after tax", near(q2.cost, 15000 + 15000 * 0.1013 / 4 * 0.85) && q2.face === q2.cost && q2.couponsPerYear === 4, q2);
check("profit at maturity: the whole profit, or the last payment", near(profitAtMaturity(td), td.face - 10000) && near(profitAtMaturity(quarterly), 379.875));
const sheet = "Alfalah Term Deposits Tenor Monthly Annually / Maturity 1 Month - 9.80% 1 Month - 10.05% 3 Months 9.60% 9.70% 3 Months 9.85% 9.95% Alfa Term Deposits (Digital) Tenor Monthly Maturity Short Notice Term Deposit 7 Days - 10.10% Tenor Maturity 1 Month - 10.15% 7 Days 10.10% 3 Months 10.05% 10.15% 6 Months 10.00% 10.25% 1 Year 10.70% 11.30% Alfa Term Deposits can only be booked through Alfa app only.";
const rates = parseAlfaTermRates(sheet);
check("Bank Alfalah's sheet: the Alfa (digital) table only, the rate at maturity", JSON.stringify(rates) === JSON.stringify({ 1: 10.15, 3: 10.15, 6: 10.25, 12: 11.3 }), rates);
check("no Alfa table: nothing", Object.keys(parseAlfaTermRates("Alfalah Term Deposits 3 Months 9.60% 9.70%")).length === 0);
check("a sheet's date from its file name", sheetDate("https://x/BAFL%20-%20Deposit%20Rate%20Sheet%20-%2021st%20August%202026.pdf") === "2026-08-21" && sheetDate("https://x/BAFL%20-%20Rate%20Sheet%2026Nov25.pdf") === "2025-11-26" && sheetDate("https://x/Format%20Aug%202026.pdf") === null);
check("the message", rolledMessage({ name: "Bank Alfalah FD", cost: 10217.46, ratePct: 10.15, to: "2027-04-12", estimated: false }) === "🔁 <b>Bank Alfalah FD</b> rolled over: Rs 10,217 to 12 Apr 2027 at 10.15% (the bank's rate sheet).", rolledMessage({ name: "Bank Alfalah FD", cost: 10217.46, ratePct: 10.15, to: "2027-04-12", estimated: false }));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
