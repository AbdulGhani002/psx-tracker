// Income month by month over the financial year (lib/calculations/income-calendar).
//
//   npx tsx scripts/test-income-calendar.ts

import { incomeCalendar, type IncomeInput } from "../lib/calculations/income-calendar";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

const input: IncomeInput = {
  today: "2026-10-11",
  dividends: [
    { date: "2026-08-20", net: 10_000 },
    { date: "2026-05-02", net: 7_000 }, // last year
  ],
  announced: [
    { date: "2026-10-05", net: 3_000 }, // book closure passed, not yet recorded
    { date: "2026-10-20", net: 5_000 },
  ],
  forecast: [{ date: "2027-02-15", gross: 20_000 }],
  dividendTaxPct: 15,
  fixed: [
    { date: "2026-09-15", net: 51_000 },
    { date: "2027-01-10", net: 85_000 },
    { date: "2027-07-10", net: 51_000 }, // next year
  ],
  cash: [{ value: 1_200_000, ratePct: 10, taxPct: 15 }],
};
const cal = incomeCalendar(input);
const at = (key: string) => cal.months.find((m) => m.key === key)!;

check("the year runs July to June", cal.fyLabel === "FY26-27" && cal.months.length === 12 && cal.months[0].key === "2026-07" && cal.months[0].label === "Jul" && cal.months[11].key === "2027-06" && cal.months[11].label === "Jun", cal.months.map((m) => m.key).join());
check("months before this one are past", cal.months.filter((m) => m.past).map((m) => m.label).join() === "Jul,Aug,Sep");
check("a recorded dividend is received in its month; last year's is left out", at("2026-08").dividends.received === 10_000 && cal.months.every((m) => m.key === "2026-08" || m.dividends.received === 0 || m.key === "2026-10"));
check("an announced dividend whose date has passed is received, a later one expected", at("2026-10").dividends.received === 3_000 && at("2026-10").dividends.expected === 5_000);
check("a forecast is expected, after dividend tax", near(at("2027-02").dividends.expected, 17_000));
check("a coupon paid is received, a maturity to come expected, next year's left out", at("2026-09").fixed.received === 51_000 && at("2027-01").fixed.expected === 85_000 && cal.months.reduce((s, m) => s + m.fixed.received + m.fixed.expected, 0) === 136_000);
check("savings: a month's profit after tax from this month on", near(at("2026-10").cash.expected, 8_500) && near(at("2027-06").cash.expected, 8_500) && at("2026-09").cash.expected === 0, at("2026-10").cash.expected);
check("totals: received and expected", near(cal.received, 10_000 + 3_000 + 51_000) && near(cal.expected, 5_000 + 17_000 + 85_000 + 9 * 8_500), `${cal.received} / ${cal.expected}`);
check("month totals add up", cal.months.every((m) => near(m.received + m.expected, m.dividends.received + m.dividends.expected + m.fixed.received + m.fixed.expected + m.cash.received + m.cash.expected)));
check("it says which rows have anything", cal.hasFixed && cal.hasCash);

const jan = incomeCalendar({ ...input, today: "2027-01-15" });
check("in January the year is still FY26-27, and the T-bill due on the 10th has come in", jan.fyLabel === "FY26-27" && jan.months.find((m) => m.key === "2027-01")!.fixed.received === 85_000);
const july = incomeCalendar({ ...input, today: "2027-07-01" });
check("on 1 July a new year starts", july.fyLabel === "FY27-28" && july.months[0].key === "2027-07" && july.months[0].fixed.expected === 51_000 && !july.months[0].past);
const empty = incomeCalendar({ ...input, dividends: [], announced: [], forecast: [], fixed: [], cash: [] });
check("nothing at all: zero, and no extra rows", empty.received === 0 && empty.expected === 0 && !empty.hasFixed && !empty.hasCash);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
