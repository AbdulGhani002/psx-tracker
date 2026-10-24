// The trading scorecard (lib/calculations/scorecard).
//
//   npx tsx scripts/test-scorecard.ts

import { salesFrom, scoreMessage, scoreOf } from "../lib/calculations/scorecard";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

const sales = salesFrom([
  { symbol: "PTL", soldDate: "2026-10-13", proceeds: 50000, cost: 60000, gain: -10000 },
  { symbol: "PTL", soldDate: "2026-10-13", proceeds: 93500, cost: 90000, gain: 3500 }, // the same sale, a second lot
  { symbol: "MEBL", soldDate: "2026-10-20", proceeds: 22000, cost: 20000, gain: 2000 },
  { symbol: "LUCK", soldDate: "2026-10-22", proceeds: 11000, cost: 10000, gain: 1000 },
]);
check("one result a sale, its lots added up", sales.length === 3 && near(sales[0].gain, -6500) && near(sales[0].cost, 150000));

const s = scoreOf(sales, 600);
check("how many sales won", s.sales === 3 && s.wins === 2 && near(s.winRate, (2 / 3) * 100));
check("average win and loss, as % of what the shares cost", near(s.avgWinPct, 10) && near(s.avgLossPct, (-6500 / 150000) * 100));
check("the average result a sale and the total", near(s.perSale, (-6500 + 2000 + 1000) / 3) && near(s.total, -3500));
check("costs against the winning sales' gains", near(s.feesPctOfGains, 20));
check("no sales: nothing to score", scoreOf([], 0).winRate === null && scoreMessage("October", scoreOf([], 0)) === null);
check("the month's line", scoreMessage("October 2026", s) === "📒 <b>Trading, October 2026</b>: 3 sales, 2 won (67%) · average win +10.0%, loss −4.3% · −Rs 1,167 a sale · costs Rs 600 (20% of the gains).", scoreMessage("October 2026", s));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
