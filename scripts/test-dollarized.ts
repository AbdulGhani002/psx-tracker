// The book in dollars: every flow at its own day's USD/PKR rate, the value
// now at today's.
//
//   npx tsx scripts/test-dollarized.ts

import { rateOn, flowOf, dollarize, investedUsdSeries } from "../lib/analytics/dollarized";
import { hourlyMedians, mergeFx } from "../lib/timeseries/macro";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

const rates = [
  { date: "2025-01-01", close: 280 },
  { date: "2025-06-02", close: 290 },
  { date: "2026-01-01", close: 300 },
];

check("the rate on a day is that day's close", rateOn(rates, "2025-06-02") === 290);
check("between closes, the last one before", rateOn(rates, "2025-12-31") === 290);
check("before the series, its first close", rateOn(rates, "2024-05-01") === 280);
check("after it, the latest", rateOn(rates, "2026-09-28") === 300);
check("no rates, no rate", rateOn([], "2026-01-01") === null);

check("buys and rights are money in", flowOf({ date: "2025-01-01", type: "BUY", netAmount: 1000 }) === 1000 && flowOf({ date: "2025-01-01", type: "RIGHT", netAmount: 50 }) === 50);
check("sales and dividends are money out", flowOf({ date: "2025-01-01", type: "SELL", netAmount: 800 }) === -800 && flowOf({ date: "2025-01-01", type: "DIVIDEND", netAmount: 30 }) === -30);
check("bonus shares and splits move no money", flowOf({ date: "2025-01-01", type: "BONUS", netAmount: 0 }) === 0 && flowOf({ date: "2025-01-01", type: "SPLIT" }) === 0);
check("a negative stored amount still counts by its type", flowOf({ date: "2025-01-01", type: "SELL", netAmount: -800 }) === -800);

// Rs 280,000 in at 280 ($1,000), Rs 290,000 at 290 ($1,000), a Rs 30,000
// dividend taken at 300 ($100 out); worth Rs 630,000 now at 300 ($2,100).
const txs = [
  { date: "2025-01-01", type: "BUY", netAmount: 280000, symbol: "A" },
  { date: "2025-06-02", type: "BUY", netAmount: 290000, symbol: "B" },
  { date: "2026-01-01", type: "DIVIDEND", netAmount: 30000, symbol: "A" },
];
const d = dollarize(txs, 630000, rates)!;
check("dollars put in: each flow at its own day's rate", near(d.putInUsd, 1900));
check("worth now at today's rate", near(d.valueUsd, 2100) && d.rateNow === 300 && d.rateDate === "2026-01-01");
check("the dollar return is the difference, on the dollars put in", near(d.returnUsd, 200) && near(d.returnPct, (200 / 1900) * 100));
check("the same sum in rupees is higher when the rupee fell", near(d.putInPkr, 540000) && near(d.returnPkrPct, (90000 / 540000) * 100) && d.returnPkrPct! > d.returnPct!);
check("the rupee's move since the first buy", d.firstDate === "2025-01-01" && d.rateFirst === 280 && near(d.rupeePct, (280 / 300 - 1) * 100));
check("no buys, nothing to say", dollarize([{ date: "2025-01-01", type: "DIVIDEND", netAmount: 10 }], 0, rates) === null && dollarize(txs, 1, []) === null);

const line = investedUsdSeries([...txs, { date: "2026-01-01", type: "SELL", netAmount: 150000 }], ["2024-12-31", "2025-01-01", "2025-06-02", "2025-12-31", "2026-01-01"], rates);
check("the dollar invested line: buys less sales at their days' rates, dividends left out like the rupee line", JSON.stringify(line.map((v) => Math.round(v))) === JSON.stringify([0, 1000, 2000, 2000, 1500]), line.map((v) => Math.round(v)).join(","));

// The rupee from Yahoo's hourly prices: each Karachi day's median hour.
const t0 = Date.UTC(2026, 8, 24, 0, 0) / 1000; // 05:00 in Karachi, 24 Sep
const hm = hourlyMedians([t0, t0 + 3600, t0 + 7200, t0 + 20 * 3600], [277.0, 276.8, 290, 277.1]);
check("a day's rate is its median hour, a stray tick outvoted", hm.get("2026-09-24") === 277.0);
check("and the day is Karachi's: 01:00 there is the next day", hm.get("2026-09-25") === 277.1 && hm.size === 2);
check("an even count takes the middle two", hourlyMedians([t0, t0 + 3600], [276, 278]).get("2026-09-24") === 277);

const bar = (date: string, close: number) => ({ date, close, volume: 0, vwap: close });
const merged = mergeFx(
  [bar("2026-09-01", 280), bar("2026-09-07", 269.27), bar("2026-09-08", 277.15), bar("2026-09-24", 268.55)],
  new Map([["2026-09-05", 277.0], ["2026-09-09", 277.1], ["2026-09-24", 276.89]])
);
const mm = new Map(merged.map((b) => [b.date, b.close]));
check("before the hourly prices begin, the daily close stands", mm.get("2026-09-01") === 280);
check("an hourly day replaces the daily close (the bad 268.55 goes)", mm.get("2026-09-24") === 276.89);
check("a daily close 3% off its hourly neighbours is dropped, one in line kept", !mm.has("2026-09-07") && mm.get("2026-09-08") === 277.15);
check("the merged series runs in date order", merged.map((b) => b.date).join() === "2026-09-01,2026-09-05,2026-09-08,2026-09-09,2026-09-24");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
