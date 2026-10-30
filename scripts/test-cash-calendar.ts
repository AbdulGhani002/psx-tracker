// The cash calendar (lib/calculations/cash-calendar): dividends from book
// closures, coupons and maturities, the price rules' next adds.
//
//   npx tsx scripts/test-cash-calendar.ts

import { buildCashCalendar, dividendItems, dividendPayDay, fixedItems, ruleNeeds } from "../lib/calculations/cash-calendar";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const today = "2026-10-24";
check("a dividend lands about three weeks after the book closure", dividendPayDay("2026-10-21") === "2026-11-11");

const div = dividendItems({
  today,
  days: 90,
  taxPct: 15,
  held: [{ symbol: "AHCL", shares: 21019 }, { symbol: "CSAP", shares: 173 }, { symbol: "MEBL", shares: 889 }, { symbol: "HUBC", shares: 12 }],
  payouts: [
    { symbol: "AHCL", bookClosure: "2026-10-21", pctOfFace: 125, face: 1, cycle: "F" }, // closed, recorded by the job
    { symbol: "CSAP", bookClosure: "2026-10-22", pctOfFace: 35, face: 10, cycle: "F" }, // closed, recorded
    { symbol: "MEBL", bookClosure: "2026-11-18", pctOfFace: 80, face: 10, cycle: "i" }, // still to close
    { symbol: "HUBC", bookClosure: "2026-10-13", pctOfFace: 50, face: 10, cycle: "F" }, // closed, paid already (entered by hand)
    { symbol: "MEBL", bookClosure: "2026-09-01", pctOfFace: 70, face: 10, cycle: "i" }, // landed before today
  ],
  recorded: [
    { symbol: "AHCL", date: "2026-10-21", net: 22332.69, auto: true },
    { symbol: "CSAP", date: "2026-10-22", net: 514.67, auto: true },
    { symbol: "HUBC", date: "2026-10-13", net: 51, auto: true },
    { symbol: "HUBC", date: "2026-10-30", net: 51, auto: false },
  ],
});
const ahcl = div.find((d) => d.label.startsWith("AHCL"));
check("a book closure passed: the dividend recorded, owed", ahcl?.pkr === 22333 && ahcl.claim === "receivable" && ahcl.date === "2026-11-11" && ahcl.about, ahcl);
const mebl = div.find((d) => d.label.startsWith("MEBL"));
check("a book closure to come: on the shares held now, after tax, expected", mebl?.pkr === Math.round(889 * 8 * 0.85) && mebl.claim === "expected" && mebl.label === "MEBL interim dividend", mebl);
check("one entered by hand after its book closure has been paid", !div.some((d) => d.label.startsWith("HUBC")));
check("one that landed before today is not coming", div.filter((d) => d.label.startsWith("MEBL")).length === 1);

const fixed = fixedItems({
  today,
  days: 90,
  holdings: [
    { name: "12M T-bill", face: 100000, maturityDate: "2026-12-10", events: [{ date: "2026-12-10", what: "maturity", gross: 11000, tax: 1650 }] },
    { name: "Bank Alfalah FD", face: 10800, maturityDate: "2027-03-12", events: [{ date: "2027-03-12", what: "maturity", gross: 800, tax: 120 }] },
    { name: "Ijara sukuk", face: 50000, maturityDate: "2029-06-30", events: [{ date: "2026-12-30", what: "coupon", gross: 2875, tax: 431.25 }, { date: "2027-06-30", what: "coupon", gross: 2875, tax: 431.25 }] },
  ],
});
check("a T-bill repays its face less the tax on its profit", fixed.find((x) => x.label === "12M T-bill matures")?.pkr === 98350);
check("a deposit maturing past 90 days is not in", !fixed.some((x) => x.label.startsWith("Bank Alfalah")));
check("a sukuk's coupon within the window, after tax", fixed.filter((x) => x.kind === "coupon").length === 1 && fixed.find((x) => x.kind === "coupon")?.pkr === 2444);
const rolling = fixedItems({
  today,
  days: 90,
  holdings: [
    { name: "FD all", face: 10255.84, cost: 10000, rollover: "all", maturityDate: "2026-12-12", events: [{ date: "2026-12-12", what: "maturity", gross: 255.84, tax: 38.38 }] },
    { name: "FD principal", face: 10255.84, cost: 10000, rollover: "principal", maturityDate: "2026-12-12", events: [{ date: "2026-12-12", what: "maturity", gross: 255.84, tax: 38.38 }] },
    { name: "FD quarterly", face: 15000, cost: 15000, rollover: "all", maturityDate: "2026-12-18", events: [{ date: "2026-12-18", what: "coupon", gross: 379.88, tax: 56.98 }] },
  ],
});
check("rolling over principal and profit: nothing comes in", !rolling.some((x) => x.label.startsWith("FD all") || x.label.startsWith("FD quarterly")), rolling);
check("rolling over the principal only: the profit after tax comes in", rolling.length === 1 && rolling[0].label === "FD principal profit (principal rolls over)" && rolling[0].pkr === 217, rolling);

const needs = ruleNeeds([
  { symbol: "LUCK", shares: 100, nextAdd: { move: -20, sizePct: 10, price: 400 } },
  { symbol: "PTL", shares: 3, nextAdd: { move: -30, sizePct: 20, price: 40 } },
  { symbol: "MARI", shares: 50, nextAdd: { move: -20, sizePct: 10, price: 600 }, addsOff: true },
  { symbol: "HUBC", shares: 12, nextAdd: null },
]);
check("each next add: its share of the shares held, at its price", needs.length === 2 && needs[0].qty === 10 && needs[0].pkr === 4000);
check("a small holding still buys at least one share", needs.find((n) => n.symbol === "PTL")?.qty === 1);

const cal = buildCashCalendar({ today, days: 90, cashNow: 1000, items: [...div, ...fixed], needs });
check("dated, in order, with 30/60/90-day totals", cal.items[0].date <= cal.items[cal.items.length - 1].date && cal.in90 === cal.items.reduce((s, x) => s + x.pkr, 0) && cal.in30 <= cal.in60 && cal.in60 <= cal.in90, [cal.in30, cal.in60, cal.in90]);
check("covered: the adds need less than cash now and what comes in", cal.needsTotal === 4040 && cal.shortBy === 0);
check("short when they need more", buildCashCalendar({ today, cashNow: 1000, items: [], needs }).shortBy === 3040);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
