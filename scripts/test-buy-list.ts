// The buy list's tiers against closing files (lib/buy-list/zones.ts).
//
//   npx tsx scripts/test-buy-list.ts

import { advance, cleanTiers, reachMessage, awayPct, zoneText, type Tier } from "../lib/buy-list/zones";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const tiers = cleanTiers([{ high: 380, low: 360, note: " buy 100 " }, { high: 410 }, { high: -5 }, { high: 400, low: 420 }], "2026-10-13");
check("tiers: highest first, bad prices out, a floor over its top dropped, notes trimmed, armed today", tiers.length === 3 && tiers.map((t) => t.high).join() === "410,400,380" && tiers[1].low === null && tiers[2].low === 360 && tiers[2].note === "buy 100" && tiers.every((t) => t.armedAt === "2026-10-13" && !t.reachedAt), tiers);
check("at most six tiers", cleanTiers(Array.from({ length: 9 }, (_, k) => ({ high: 100 - k })), "2026-10-13").length === 6);

const days = [
  { date: "2026-10-12", low: 395, close: 400 }, // before it was saved: does not count
  { date: "2026-10-13", low: 412, close: 415 },
  { date: "2026-10-14", low: 398, close: 402 }, // tiers 1 and 2 at once
  { date: "2026-10-15", low: 385, close: 390 },
];
const r1 = advance(tiers, days);
check("a day before the tier was saved does not count", !r1.reached.some((x) => x.date === "2026-10-12"));
check("reached on the first day its low got to the top; two tiers the same day", r1.reached.length === 2 && r1.reached[0].tier === 0 && r1.reached[0].date === "2026-10-14" && r1.reached[1].tier === 1 && r1.tiers[0].reachedLow === 398 && r1.tiers[0].reachedClose === 402, r1.reached);
check("the third tier waits", r1.tiers[2].reachedAt === "");
check("the input is left as it was", tiers[0].reachedAt === "");

const r2a = advance(r1.tiers, [{ date: "2026-10-16", low: 380, close: 381 }, { date: "2026-10-19", low: 410, close: 425 }]);
check("a reached tier is not told twice; the next one is", r2a.reached.length === 1 && r2a.reached[0].tier === 2);
check("a close 5% over a reached tier's top arms it again; under that it stays reached", r2a.tiers[0].reachedAt === "2026-10-14" && r2a.tiers[1].reachedAt === "" && r2a.tiers[1].armedAt === "2026-10-19" && r2a.tiers[2].reachedAt === "", r2a.tiers);
const r2 = advance(r1.tiers, [{ date: "2026-10-16", low: 380, close: 381 }, { date: "2026-10-19", low: 410, close: 431 }]);
const r3 = advance(r2.tiers, [{ date: "2026-10-20", low: 409, close: 412 }]);
check("armed again, it is reached again", r3.reached.length === 1 && r3.reached[0].tier === 0 && r3.tiers[0].reachedAt === "2026-10-20");
check("days out of order are put in order", advance(tiers, [days[3], days[1]]).reached.map((x) => `${x.tier}:${x.date}`).join() === "0:2026-10-15,1:2026-10-15");
check("a day with no price is skipped", advance(tiers, [{ date: "2026-10-14", low: 0, close: 0 }]).reached.length === 0);

const msg = reachMessage("MEBL", r1.tiers, 1, { date: "2026-10-14", low: 398, close: 402 });
check("the message: tier of how many, its zone, the day's low and close, the next tier", msg === "🎯 <b>MEBL</b> reached buy tier 2 of 3 (≤ 400.00): low 398.00, close 402.00 on Wed 14 Oct.\n   Next: tier 3 at 360.00–380.00.", msg);
check("with the tier's note, escaped", reachMessage("A&B", r1.tiers, 2, { date: "2026-10-15", low: 1385.5, close: 1390 }).includes("<b>A&amp;B</b>") && reachMessage("X", r1.tiers, 2, { date: "2026-10-15", low: 1385.5, close: 1390 }).includes("low 1,386") && reachMessage("X", r1.tiers, 2, { date: "2026-10-15", low: 1, close: 1 }).includes("   buy 100"));
check("how far away: positive above, nothing without a price", awayPct(420, { high: 400 }) === 5 && awayPct(390, { high: 400 }) === -2.5 && awayPct(null, { high: 400 }) === null);
check("zones read as a range or 'at or under'", zoneText({ high: 400, low: 380 }) === "380.00–400.00" && zoneText({ high: 1200, low: null }) === "≤ 1,200");

const t: Tier = { high: 100, low: null, note: "", armedAt: "", reachedAt: "", reachedLow: null, reachedClose: null };
check("a tier with no date armed counts from any day", advance([t], [{ date: "2020-01-01", low: 99, close: 101 }]).reached.length === 1);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
