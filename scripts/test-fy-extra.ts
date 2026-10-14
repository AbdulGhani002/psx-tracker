// The year table's extras (lib/analytics/fy-extra): index change over a
// financial year, the T-bill and policy-rate comparisons, and the rest of the
// book (funds, savings, T-bills and deposits) split by year so the years add
// up to the total.
//
//   npx tsx scripts/test-fy-extra.ts

import { closeOn, indexChangePct, tbillPct, policyPct, otherByYear, dayBefore, tbillFor } from "../lib/analytics/fy-extra";
import { SBP_TBILL12M_YEAR_START } from "../lib/timeseries/sbp-tbill";
import { fyWindow } from "../lib/analytics/fy-profit";
import { valueSavings } from "../lib/calculations/assets";
import { valueFixedIncome } from "../lib/fixed-income/value";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) < tol;

const closes = [
  { date: "2024-06-27", close: 78000 },
  { date: "2024-06-28", close: 78445 },
  { date: "2025-06-27", close: 125000 },
  { date: "2025-06-30", close: 125627 },
  { date: "2026-06-30", close: 160000 },
  { date: "2026-10-13", close: 170512 },
];
const FY25 = fyWindow(2025, "2026-10-14"), FY26 = fyWindow(2026, "2026-10-14"), FY27 = fyWindow(2027, "2026-10-14");

check("the close on a day with none is the last one before it", closeOn(closes, "2024-06-30") === 78445 && closeOn(closes, "2025-06-29") === 125000);
check("no close before the series starts", closeOn(closes, "2024-01-01") === null);
check("an index's year: the close before it to the year's last", near(indexChangePct(closes, FY25), (125627 / 78445 - 1) * 100), indexChangePct(closes, FY25)?.toFixed(2));
check("the year under way runs to the latest close", near(indexChangePct(closes, FY27), (170512 / 160000 - 1) * 100), indexChangePct(closes, FY27)?.toFixed(2));
check("no % without a close before the year", indexChangePct(closes.slice(2), FY25) === null);

check("a year's T-bill is its yield", tbillPct(11, FY26) === 11);
check("the year under way: the share of the yield earned so far", near(tbillPct(11, FY27), (11 * 106) / 365), tbillPct(11, FY27).toFixed(3));
const steps = [{ from: "2025-05-05", rate: 11 }, { from: "2024-07-29", rate: 19.5 }, { from: "2024-06-10", rate: 20.5 }];
check("a whole year at one policy rate compounds to it", near(policyPct([{ from: "2020-01-01", rate: 11 }], FY26), (Math.pow(1.11, 365 / 365) - 1) * 100, 1e-6), policyPct([{ from: "2020-01-01", rate: 11 }], FY26).toFixed(4));
const mixed = policyPct(steps, FY25);
check("a year of cuts sits between the rates it had", mixed > 11 && mixed < 20.5, mixed.toFixed(2));

const years = [FY25, FY26, FY27];
const savings = { ratePercent: 10, anchorDate: "2025-10-01", anchorBalance: 100000, movements: [{ date: "2026-01-15", type: "DEPOSIT" as const, amount: 50000 }, { date: "2026-08-01", type: "WITHDRAWAL" as const, amount: 20000 }] };
const tbill = { kind: "tbill" as const, name: "12M T-bill", face: 110000, cost: 100000, purchaseDate: "2026-02-01", maturityDate: "2027-01-31", couponPct: 0, couponsPerYear: 0, taxPct: 15 };
const other = otherByYear(
  {
    funds: [{ trades: [{ date: "2026-03-01", side: "BUY", realizedGain: 0 }, { date: "2026-09-21", side: "REDEEM", realizedGain: 1898 }], openGain: 0 }, { trades: [{ date: "2026-05-01", side: "BUY", realizedGain: 0 }, { date: "2026-06-10", side: "REDEEM", realizedGain: 400 }], openGain: 250 }],
    savings: [savings],
    fixed: [tbill],
  },
  years,
  "2026-10-14"
);
const sum = (k: "funds" | "savings" | "fixed") => [...other.values()].reduce((s, r) => s + r[k], 0);
check("a fund's gain counts in the year it was redeemed", near(other.get(2026)!.funds, 400) && near(other.get(2027)!.funds, 1898 + 250), JSON.stringify([other.get(2026)!.funds, other.get(2027)!.funds]));
check("savings: nothing before the account's known balance", near(other.get(2025)!.savings, 0));
check("savings: the years add up to the profit today", near(sum("savings"), valueSavings(savings, "2026-10-14").profit, 1e-6), sum("savings").toFixed(2));
check("savings: each year is the interest of that year", other.get(2026)!.savings > 0 && other.get(2027)!.savings > 0);
check("a T-bill: the years add up to its profit so far", near(sum("fixed"), valueFixedIncome(tbill, "2026-10-14").profitSoFar, 1e-6), sum("fixed").toFixed(2));
check("and none before it was bought", near(other.get(2025)!.fixed, 0) && other.get(2026)!.fixed > 0);
check("the day before a year's first day is 30 June", dayBefore("2025-07-01") === "2025-06-30");

// Which 12-month T-bill rate a year is compared with.
const sbp = [{ endYear: 2026, auction: "2025-06-25", pct: 10.9274 }];
check("the rate the user set wins", tbillFor(2026, { "2026": 11.5 }, sbp, 10)?.from === "entered" && tbillFor(2026, { "2026": 11.5 }, sbp, 10)?.rate === 11.5);
check("else SBP's auction before the year, with its date", tbillFor(2026, {}, sbp, 10)?.from === "sbp" && tbillFor(2026, {}, sbp, 10)?.auction === "2025-06-25");
check("else the July rates, else none", tbillFor(2027, {}, sbp, 11.2)?.from === "monthly" && tbillFor(2027, {}, sbp, null) === null);
check("SBP's history: each auction in the fortnight before the year's 1 July, at a believable rate", SBP_TBILL12M_YEAR_START.every((x) => x.auction <= `${x.endYear - 1}-07-01` && x.auction >= `${x.endYear - 1}-06-15` && x.pct > 0 && x.pct < 30 && x.source.length > 0) && SBP_TBILL12M_YEAR_START.length === 3);
check("FY25-26 against a bill bought at 10.93%", near(tbillPct(10.9274, fyWindow(2026, "2026-10-14")), 10.9274));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
