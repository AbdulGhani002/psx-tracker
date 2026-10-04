// Profit by financial year (lib/analytics/fy-profit): dividends counted once
// when reinvested, bonus and split neutral, sales, new money, the year's
// money-weighted return, and a missing price.
//
//   npx tsx scripts/test-fy-profit.ts

import { fyOf, fyWindow, fyProfit, sharesAt, type FyTx } from "../lib/analytics/fy-profit";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) < tol;

const FY = fyWindow(2026, "2026-10-04"); // FY25-26, over
const buy = (symbol: string, date: string, shares: number, px: number): FyTx => ({ symbol, type: "BUY", date, shares, netAmount: shares * px });
const sell = (symbol: string, date: string, shares: number, px: number): FyTx => ({ symbol, type: "SELL", date, shares: -shares, netAmount: shares * px });
const div = (symbol: string, date: string, amount: number, tax = 0): FyTx => ({ symbol, type: "DIVIDEND", date, shares: 0, netAmount: amount, taxDeducted: tax });
const flat = (start: Record<string, number>, end: Record<string, number>) => ({ start: (s: string) => start[s] ?? null, end: (s: string) => end[s] ?? null });

check("the year runs July to June and is named for both", fyOf("2026-07-01") === 2027 && fyOf("2026-06-30") === 2026 && FY.label === "FY25-26" && FY.start === "2025-07-01" && FY.end === "2026-06-30" && !FY.current);
const cur = fyWindow(2027, "2026-10-04");
check("the year not over ends today", cur.current && cur.end === "2026-10-04" && cur.label === "FY26-27");

// Held through the year, the price up from 50 to 60.
const held = [buy("A", "2025-01-10", 100, 40)];
const r1 = fyProfit(held, FY, flat({ A: 50 }, { A: 60 }), 0);
check("held all year: the profit is the change in worth", near(r1.profit, 1000) && near(r1.capitalGain, 1000) && near(r1.startValue, 5000) && near(r1.endValue, 6000), r1.profit);
check("and the return is on the worth at the start", near(r1.returnPct, 20), r1.returnPct);

// A dividend paid and spent on more shares: profit once, as the dividend.
const reinvest = [...held, div("A", "2025-10-01", 500, 75), buy("A", "2025-10-03", 10, 50)];
const r2 = fyProfit(reinvest, FY, flat({ A: 50 }, { A: 50 }), 0);
check("a reinvested dividend is profit once, the shares it bought add nothing", near(r2.profit, 500) && near(r2.dividends, 500) && near(r2.capitalGain, 0), r2.profit);
check("the tax withheld on it is reported, not counted again", near(r2.dividendTax, 75));
const r2b = fyProfit(reinvest, FY, flat({ A: 50 }, { A: 55 }), 0);
check("what those shares then gain is price gain on all 110", near(r2b.capitalGain, 110 * 5) && near(r2b.profit, 500 + 550));

// New money in the year.
const r3 = fyProfit([buy("B", "2025-12-01", 100, 10)], FY, flat({}, { B: 12 }), 0);
check("new money: the profit is what it gained, not what was put in", near(r3.profit, 200) && near(r3.bought, 1000) && near(r3.startValue, 0));

// A bonus issue and a split change the shares, not the worth.
const bonus = [buy("C", "2025-03-01", 100, 90), { symbol: "C", type: "BONUS", date: "2025-11-10", shares: 10, netAmount: 0 } as FyTx];
const r4 = fyProfit(bonus, FY, flat({ C: 110 }, { C: 100 }), 0);
check("a 10% bonus at actual prices: 100 at 110 is 110 at 100, no profit invented", near(r4.profit, 0) && near(r4.endValue, 11000));
const split = [buy("D", "2025-03-01", 100, 50), { symbol: "D", type: "SPLIT", date: "2026-02-01", shares: 0, netAmount: 0, ratio: "1:2" } as FyTx];
const r5 = fyProfit(split, FY, flat({ D: 50 }, { D: 25 }), 0);
check("a 1:2 split doubles the shares at half the price", near(r5.profit, 0) && sharesAt(split, "2026-06-30").get("D") === 200);

// A sale in the year: the proceeds come out, the gain on them stays.
const sold = [buy("E", "2025-01-01", 100, 30), sell("E", "2026-01-15", 50, 60)];
const r6 = fyProfit(sold, FY, flat({ E: 50 }, { E: 60 }), 50 * 30);
check("half sold at 60 after starting the year at 50: the year's gain is 10 a share on all 100", near(r6.profit, 1000) && near(r6.sold, 3000) && near(r6.endValue, 3000), r6.profit);
check("the realised part is passed through for the CGT line", near(r6.realized, 1500));

// Money-weighted: a buy half way through counts for half the year.
const mid = [buy("F", "2025-01-01", 100, 10), buy("F", "2025-12-30", 100, 10)];
const r7 = fyProfit(mid, FY, flat({ F: 10 }, { F: 11 }), 0);
const T = (Date.parse("2026-06-30") - Date.parse("2025-06-30")) / 86400000;
const w = (Date.parse("2026-06-30") - Date.parse("2025-12-30")) / 86400000 / T;
check("Modified Dietz: profit over the start plus the weighted flows", near(r7.returnPct, (200 / (1000 + w * 1000)) * 100), r7.returnPct?.toFixed(3));

// Money in at the very end of the year: no percentage.
const late = fyProfit([buy("H", "2026-06-20", 100, 300), div("P", "2026-06-25", 95)], FY, flat({}, { H: 305 }), 0);
check("money that came in the last days of the year gets no %, the rupees stand", late.returnPct === null && late.returnShort && near(late.profit, 500 + 95));
check("a year with the money at work keeps its %", r7.returnPct != null && !r7.returnShort);

// A name with no price at the start: taken as unchanged, flagged.
const r8 = fyProfit([...held, div("A", "2025-09-01", 300)], FY, flat({}, { A: 60 }), 0);
check("a missing start price is the end's: no gain invented, the dividend stays, the name is flagged", near(r8.capitalGain, 0) && near(r8.profit, 300) && r8.missingPrices.join() === "A");

// Several names: the total is the sum of the names.
const many = [...held, ...sold, buy("B", "2025-12-01", 100, 10)];
const r9 = fyProfit(many, FY, flat({ A: 50, E: 50 }, { A: 60, E: 60, B: 12 }), 0);
check("the year's profit is the sum over the names", near(r9.profit, r9.stocks.reduce((a, s) => a + s.profit, 0)) && near(r9.profit, 1000 + 1000 + 200) && r9.stocks[0].profit >= r9.stocks[r9.stocks.length - 1].profit);
check("a name sold out before the year does not appear", fyProfit([buy("G", "2024-01-01", 10, 5), sell("G", "2024-05-01", 10, 6), ...held], FY, flat({ A: 50 }, { A: 60 }), 0).stocks.every((s) => s.symbol !== "G"));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
