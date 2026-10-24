// The evening brief (lib/calculations/daily-brief), the buy list's monthly
// review (lib/calculations/missed-trades) and the buy-list dividend message
// (lib/calculations/exdate).
//
//   npx tsx scripts/test-daily-brief.ts

import { BIG, dailyBrief, normalDayPct, timesNormal } from "../lib/calculations/daily-brief";
import { missedMessage, missedReview } from "../lib/calculations/missed-trades";
import { announcedDividendMessage } from "../lib/calculations/exdate";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

// Alternating +1% and −1% days: a normal day is 1%; a 1% day is 1×.
const closes = [100];
for (let i = 0; i < 200; i++) closes.push(closes[closes.length - 1] * (i % 2 ? 0.99 : 1.01));
check("a normal day: the median absolute daily change", near(normalDayPct(closes), 1, 1e-6), normalDayPct(closes));
check("too short a record: no normal day", normalDayPct(closes.slice(0, 30)) === null);
check("how many normal days a move is", near(timesNormal(-3, 1), 3) && timesNormal(1, null) === null);

const msg = dailyBrief({
  date: "2026-10-22",
  kse: { close: 166419.71, changePct: 0.14, normalPct: 0.85 },
  breadth: { up: 211, down: 254, same: 107, valueRs: 18.68e9 },
  book: { value: 4213000, changeRs: -12400, changePct: -0.29 },
  movers: [{ symbol: "LUCK", changePct: -6.1, times: 4.1 }, { symbol: "MEBL", changePct: 1.6, times: 1.2 }],
  rates: { policy: 11.5, tbill: 12.4999, cpi: 10.26 },
  world: [{ label: "S&P 500", changePct: -1.09, times: 2.1 }, { label: "oil", changePct: 2.4, times: 2.6, level: "$107" }],
  next: [{ date: "2026-10-30", title: "PSX futures expiry" }, { date: "2026-10-26", title: "MPC" }, { date: "2026-10-22", title: "CSAP book closure" }],
});
const lines = msg.split("\n");
check("the head: the day, the KSE-100 and its normal day", lines[0] === "📊 <b>Thu 22 Oct</b> · KSE-100 166,420 (+0.14%, normal ±0.8%)", lines[0]);
check("breadth and value traded", lines[1] === "Breadth 211 up, 254 down · Rs 18.7bn traded", lines[1]);
check("your shares' day", lines[2] === "Your shares Rs 4,213,000: −Rs 12,400 (−0.3%)", lines[2]);
check("only a move several times its normal is named", lines[3] === "⚠ LUCK −6.1% (4.1× its normal)" && !msg.includes("MEBL"), lines[3]);
check("rates with the real policy rate (policy minus CPI)", lines[4] === "Rates: policy 11.5% · T-bill 12.5% · CPI 10.3% · real +1.2", lines[4]);
check("the world, a big move marked", lines[5] === `World: S&P 500 −1.1% · oil $107 +2.4% (2.6×)`, lines[5]);
check("the week's dates in order, today's as today", lines[6] === "Next: today CSAP book closure · Mon 26 Oct MPC · Fri 30 Oct PSX futures expiry", lines[6]);
check("a big index day says so", dailyBrief({ date: "2026-03-02", kse: { close: 150000, changePct: -9.57, normalPct: 0.9 }, breadth: null, book: null, movers: [], rates: { policy: null, tbill: null, cpi: null }, world: [], next: [] }).includes("10.6× a normal day"));
check("a quiet day with nothing known is one line", dailyBrief({ date: "2026-10-24", kse: null, breadth: null, book: null, movers: [], rates: { policy: null, tbill: null, cpi: null }, world: [], next: [] }) === "📊 <b>Sat 24 Oct</b>");
check("the threshold for a mention", BIG === 2.5);

// The buy list in October: one came to its price, one rose 14% in the month
// without coming down, one stayed well above the price but fell, one has no
// closes.
const review = missedReview([
  { symbol: "MEBL", top: 400, minLow: 395, first: 420, last: 430 },
  { symbol: "FFC", top: 300, minLow: 310, first: 300 * 1.05, last: 300 * 1.05 * 1.14 },
  { symbol: "LUCK", top: 300, minLow: 380, first: 410, last: 390 },
  { symbol: "XYZ", top: 10, minLow: null, first: null, last: null },
]);
check("came to your price: the month's low at or under it", review.came.map((c) => c.symbol).join() === "MEBL");
check("got away: never came down and rose 10%+ over the month", review.away.length === 1 && review.away[0].symbol === "FFC" && Math.round(review.away[0].risePct) === 14);
check("far above your price but not running away: still above", review.above.join() === "LUCK");
check("the month's line", missedMessage("October 2026", review) === "🧾 <b>Buy list, October 2026</b>: 1 came to your price (MEBL) · 1 got away, up 10%+ (FFC +14%) · 1 still above your price.", missedMessage("October 2026", review));
check("no list, no line", missedMessage("October 2026", missedReview([])) === null);

const hubc = announcedDividendMessage({ symbol: "HUBC", bookClosure: "2026-10-13", pctOfFace: 50, faceValue: 10, cycle: "F" }, 150, "2026-09-30");
check("a buy-list dividend: rate, last day to buy, ex-date, book closure, against today's price", hubc === "📣 <b>HUBC</b> (buy list): final dividend Rs 5 a share (50%). Last day to buy Fri 9 Oct; ex-dividend Mon 12 Oct, book closure from Tue 13 Oct. 3.3% of today's Rs 150.", hubc);
check("none once the last day to buy has gone", announcedDividendMessage({ symbol: "HUBC", bookClosure: "2026-10-13", pctOfFace: 50, faceValue: 10, cycle: "F" }, 150, "2026-10-12") === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
