// The sell list (lib/sell-list/levels): profit levels reached on a day's
// high, stops on a close, each told once and armed again 5% back the other
// way; the shares a level sells and what Telegram says.
//
//   npx tsx scripts/test-sell-list.ts

import { advance, cleanLevels, toGoPct, sharesToSell, reachMessage } from "../lib/sell-list/levels";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const levels = cleanLevels([{ price: 40, kind: "stop", sellPct: 100 }, { price: 65, kind: "profit", sellPct: 20, note: "first trim" }, { price: 80, kind: "profit" }], "2026-10-01");
check("levels: the highest price first, profit above, stops below", levels.map((l) => l.price).join() === "80,65,40" && levels[2].kind === "stop" && levels[0].sellPct === null);
check("a level counts from the day it was saved", levels.every((l) => l.armedAt === "2026-10-01" && l.reachedAt === ""));

const before = advance(levels, [{ date: "2026-09-30", high: 70, close: 66 }]);
check("a day before it was saved does not count", before.reached.length === 0);

const r1 = advance(levels, [{ date: "2026-10-02", high: 66, close: 63 }]);
check("a profit level is reached on the day's high, not the close", r1.reached.length === 1 && r1.reached[0].level === 1 && r1.levels[1].reachedPrice === 66 && r1.levels[1].reachedClose === 63, r1.reached);
const r2 = advance(r1.levels, [{ date: "2026-10-03", high: 67, close: 66 }]);
check("told once: the next day above it is quiet", r2.reached.length === 0 && r2.levels[1].reachedAt === "2026-10-02");
const r3 = advance(r2.levels, [{ date: "2026-10-06", high: 62, close: 61 }, { date: "2026-10-07", high: 66, close: 65 }]);
check("a close 5% under it arms it again, and the next high reaches it again", r3.levels[1].reachedAt === "2026-10-07" && r3.reached.length === 1, r3.levels[1]);

const s1 = advance(levels, [{ date: "2026-10-02", high: 42, close: 40.5 }, { date: "2026-10-03", high: 41, close: 39.9 }]);
check("a stop is reached on a close at or under it, not on the high or a dip", s1.reached.length === 1 && s1.reached[0].level === 2 && s1.reached[0].date === "2026-10-03", s1.reached);
const s2 = advance(s1.levels, [{ date: "2026-10-06", high: 42.5, close: 42.1 }]);
check("a stop arms again after a close 5% above it", s2.levels[2].reachedAt === "" && s2.levels[2].armedAt === "2026-10-06");

check("how far: up to a profit level, down to a stop", toGoPct(50, { price: 65 }) === 30 && toGoPct(50, { price: 40 }) === -20);
check("shares to sell: the % of those held, at least one, never more than held", sharesToSell(248, 20) === 49 && sharesToSell(3, 10) === 1 && sharesToSell(248, null) === null && sharesToSell(10, 100) === 10);

const msg = reachMessage("PTL", r1.levels[1], { date: "2026-10-02", price: 66, close: 63 }, { shares: 248, avgCost: 50.45 });
check("the profit message: the high, the close, the shares to sell and the gain on cost", msg.includes("PTL") && msg.includes("high 66.00") && msg.includes("Sell 20% = 49 shares") && msg.includes("+24.9% on your 50.45") && msg.includes("first trim"), msg);
const stopMsg = reachMessage("PTL", s1.levels[2], { date: "2026-10-03", price: 39.9, close: 39.9 }, { shares: 248, avgCost: 50.45 });
check("the stop message says it closed under the stop", stopMsg.includes("closed at 39.90") && stopMsg.includes("Sell 100% = 248 shares"), stopMsg);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
