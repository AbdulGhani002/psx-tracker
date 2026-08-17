import { evaluateZone, shouldSuggestSell, zoneWarnings, distanceToZonePct, describeZone, type ZoneEntry } from "../lib/calculations/zones";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

function entry(p: Partial<ZoneEntry>): ZoneEntry {
  return { symbol: "X", buyZoneLow: null, buyZoneHigh: null, sellZoneLow: null, sellZoneHigh: null, minSellShares: 0, ...p };
}

console.log("=== buy band ===");
{
  const e = entry({ buyZoneLow: 40, buyZoneHigh: 50 });
  ok("inside band is buy", evaluateZone(45, e).status === "buy");
  ok("at the ceiling is buy", evaluateZone(50, e).status === "buy");
  ok("at the floor is buy", evaluateZone(40, e).status === "buy");
  ok("above the ceiling is between", evaluateZone(51, e).status === "between");
  ok("below the floor is between (fell through the band)", evaluateZone(39, e).status === "between");
}
{
  // Open-ended below: "buy at or under 50" with no floor.
  const e = entry({ buyZoneHigh: 50 });
  ok("open-ended buy: 10 is buy", evaluateZone(10, e).status === "buy");
  ok("open-ended buy: 50 is buy", evaluateZone(50, e).status === "buy");
  ok("open-ended buy: 50.01 is between", evaluateZone(50.01, e).status === "between");
}

console.log("\n=== sell band ===");
{
  const e = entry({ sellZoneLow: 100, sellZoneHigh: 120 });
  ok("inside band is sell", evaluateZone(110, e).status === "sell");
  ok("at the floor is sell", evaluateZone(100, e).status === "sell");
  ok("at the ceiling is sell", evaluateZone(120, e).status === "sell");
  ok("above the ceiling is between (ran past the band)", evaluateZone(121, e).status === "between");
  ok("below the floor is between", evaluateZone(99, e).status === "between");
}
{
  const e = entry({ sellZoneLow: 100 });
  ok("open-ended sell: 5000 is sell", evaluateZone(5000, e).status === "sell");
}

console.log("\n=== both bands set ===");
{
  const e = entry({ buyZoneLow: 40, buyZoneHigh: 50, sellZoneLow: 100, sellZoneHigh: 120 });
  ok("45 is buy", evaluateZone(45, e).status === "buy");
  ok("75 between the bands is between", evaluateZone(75, e).status === "between");
  ok("110 is sell", evaluateZone(110, e).status === "sell");
}

console.log("\n=== unknown price is never a signal ===");
{
  const e = entry({ buyZoneHigh: 50 });
  ok("price 0 is unknown, not cheap", evaluateZone(0, e).status === "unknown");
  ok("null price is unknown", evaluateZone(null, e).status === "unknown");
  ok("undefined price is unknown", evaluateZone(undefined, e).status === "unknown");
  ok("NaN price is unknown", evaluateZone(NaN, e).status === "unknown");
  ok("negative price is unknown", evaluateZone(-12, e).status === "unknown");
}

console.log("\n=== no zone configured ===");
{
  ok("no bands at all is no_zone", evaluateZone(45, entry({})).status === "no_zone");
}

console.log("\n=== contradictory config yields no instruction ===");
{
  const overlap = entry({ buyZoneHigh: 100, sellZoneLow: 90 });
  const v = evaluateZone(95, overlap);
  ok("overlapping bands are a conflict", v.status === "conflict", `status=${v.status}`);
  ok("conflict explains itself", v.warnings.length > 0 && v.warnings[0].includes("sell zone starts"));
  ok("touching bands (sell low == buy high) is a conflict", evaluateZone(50, entry({ buyZoneHigh: 50, sellZoneLow: 50 })).status === "conflict");
  ok("inverted buy band is a conflict", evaluateZone(45, entry({ buyZoneLow: 60, buyZoneHigh: 50 })).status === "conflict");
  ok("inverted sell band is a conflict", evaluateZone(110, entry({ sellZoneLow: 120, sellZoneHigh: 100 })).status === "conflict");
  ok("zero-price zone is a conflict", evaluateZone(45, entry({ buyZoneHigh: 0 as any })).status !== "buy");
  ok("negative zone price is rejected", zoneWarnings(entry({ buyZoneHigh: -5 })).length > 0);
  ok("a conflict is flagged even with no price", evaluateZone(null, overlap).status === "conflict");
}

console.log("\n=== the minimum-size gate on selling ===");
{
  // The owner's rule: a small position must not generate a sell instruction.
  ok("50 held, floor 50 -> silent (at the floor is not above it)", shouldSuggestSell("sell", 50, 50) === false);
  ok("51 held, floor 50 -> suggest", shouldSuggestSell("sell", 51, 50) === true);
  ok("10 held, floor 50 -> silent", shouldSuggestSell("sell", 10, 50) === false);
  ok("1000 held, floor 50 -> suggest", shouldSuggestSell("sell", 1000, 50) === true);
  ok("floor 0 means any holding qualifies", shouldSuggestSell("sell", 1, 0) === true);
  ok("holding nothing never suggests", shouldSuggestSell("sell", 0, 0) === false);
  ok("negative holding never suggests", shouldSuggestSell("sell", -5, 0) === false);
  ok("buy status never suggests a sell", shouldSuggestSell("buy", 1000, 0) === false);
  ok("between never suggests a sell", shouldSuggestSell("between", 1000, 0) === false);
  ok("conflict never suggests a sell", shouldSuggestSell("conflict", 1000, 0) === false);
  ok("unknown price never suggests a sell", shouldSuggestSell("unknown", 1000, 0) === false);
  ok("NaN floor is treated as no floor", shouldSuggestSell("sell", 5, NaN) === true);
}

console.log("\n=== distance to a band ===");
{
  const e = entry({ buyZoneHigh: 90, sellZoneLow: 110 });
  const d = distanceToZonePct(100, e);
  ok("10% above the buy ceiling", Math.abs((d.toBuyPct ?? 0) - 10) < 1e-9, `toBuy=${d.toBuyPct}`);
  ok("10% below the sell floor", Math.abs((d.toSellPct ?? 0) - 10) < 1e-9, `toSell=${d.toSellPct}`);
  const inside = distanceToZonePct(80, e);
  ok("inside the buy band reads negative", (inside.toBuyPct ?? 0) < 0, `toBuy=${inside.toBuyPct}`);
  const none = distanceToZonePct(100, entry({}));
  ok("unset bands give null, not 0", none.toBuyPct === null && none.toSellPct === null);
}

console.log("\n=== zone descriptions never invent a bound ===");
{
  ok("buy with both bounds", describeZone(40, 50, "buy") === "Rs 40–50", describeZone(40, 50, "buy"));
  ok("buy with only a ceiling", describeZone(null, 50, "buy") === "at or under Rs 50", describeZone(null, 50, "buy"));
  ok("no buy zone says so", describeZone(null, null, "buy") === "no buy zone");
  ok("sell with only a floor", describeZone(100, null, "sell") === "at or above Rs 100", describeZone(100, null, "sell"));
  ok("no sell zone says so", describeZone(null, null, "sell") === "no sell zone");
}

console.log("\n=== a real position: PTL 643 shares ===");
{
  // Owner holds 643 PTL at avg 53.67. Say the plan is: add under 45, trim over 70,
  // and never bother selling unless more than 100 shares are held.
  const e = entry({ symbol: "PTL", buyZoneLow: null, buyZoneHigh: 45, sellZoneLow: 70, minSellShares: 100 });
  ok("at 42 it is a buy", evaluateZone(42, e).status === "buy");
  ok("at 55 (today) it is between — no action", evaluateZone(55, e).status === "between");
  const atSell = evaluateZone(72, e);
  ok("at 72 it is a sell", atSell.status === "sell");
  ok("643 held clears the 100 floor", shouldSuggestSell(atSell.status, 643, e.minSellShares) === true);
  ok("if only 80 were held it stays quiet", shouldSuggestSell(atSell.status, 80, e.minSellShares) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
