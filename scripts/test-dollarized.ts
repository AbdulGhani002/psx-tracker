// The book in dollars: every flow at its own day's USD/PKR rate, the value
// now at today's.
//
//   npx tsx scripts/test-dollarized.ts

import { rateOn, flowOf, dollarize, investedUsdSeries, dollarCostBasis, holdingDollars } from "../lib/analytics/dollarized";
import { deriveFromTransactions } from "../lib/calculations/holding";
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

// One name in dollars. At a rate of one, the dollar basis must be the rupee
// basis step for step: same shares, cost, realised and dividends.
const seq = [
  { date: "2025-01-02", type: "BUY", shares: 100, netAmount: 10000, ratio: "" },
  { date: "2025-02-03", type: "BUY", shares: 50, netAmount: 6000, ratio: "" },
  { date: "2025-03-03", type: "BONUS", shares: 15, netAmount: 0, ratio: "" },
  { date: "2025-04-01", type: "SELL", shares: -40, netAmount: 5200, ratio: "" },
  { date: "2025-05-05", type: "DIVIDEND", shares: 0, netAmount: 700, ratio: "" },
  { date: "2025-06-02", type: "SPLIT", shares: 0, netAmount: 0, ratio: "1:2" },
  { date: "2025-07-01", type: "RIGHT", shares: 20, netAmount: 1500, ratio: "" },
  { date: "2025-08-01", type: "SELL", shares: -60, netAmount: 4100, ratio: "" },
];
const rupee = deriveFromTransactions(seq as any);
const dollar = dollarCostBasis(seq, [{ date: "2000-01-01", close: 1 }]);
check("at a rate of one the dollar basis is the rupee basis", near(dollar.shares, rupee.shares) && near(dollar.costUsd, rupee.totalCost, 1e-6) && near(dollar.realizedUsd, rupee.realizedPL, 1e-6) && near(dollar.dividendsUsd, rupee.dividendsReceived), `${dollar.shares}/${rupee.shares} ${dollar.costUsd.toFixed(2)}/${rupee.totalCost.toFixed(2)}`);

// 100 shares for Rs 28,000 at 280 ($100), 100 for Rs 30,000 at 300 ($100);
// half sold for Rs 33,000 at 300 (out goes $100 of cost, $10 realised); a
// Rs 3,000 dividend at 300 ($10); the 100 left worth Rs 36,000 at 300.
const fxr = [{ date: "2025-01-01", close: 280 }, { date: "2025-06-01", close: 300 }];
const pos = [
  { date: "2025-01-02", type: "BUY", shares: 100, netAmount: 28000 },
  { date: "2025-06-02", type: "BUY", shares: 100, netAmount: 30000 },
  { date: "2025-07-01", type: "SELL", shares: -100, netAmount: 33000 },
  { date: "2025-08-01", type: "DIVIDEND", shares: 0, netAmount: 3000 },
];
const hd = holdingDollars(pos, 36000, fxr)!;
check("a sale takes out its share of the dollar cost", near(dollarCostBasis(pos, fxr).costUsd, 100) && near(dollarCostBasis(pos, fxr).realizedUsd, 10));
check("unrealised in dollars, on what the shares held cost in dollars", near(hd.valueUsd, 120) && near(hd.unrealizedUsd, 20) && near(hd.unrealizedPct, 20));
check("with dividends, the table's Total P&L in dollars", near(hd.dividendsUsd, 10) && near(hd.totalUsd, 30) && near(hd.totalPct, 30));
check("and the rupee at the first purchase", hd.firstDate === "2025-01-02" && hd.rateFirst === 280 && hd.rateNow === 300);
check("nothing held or no rates, nothing to show", holdingDollars([...pos, { date: "2025-09-01", type: "SELL", shares: -100, netAmount: 36000 }], 0, fxr) === null && holdingDollars(pos, 36000, []) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
