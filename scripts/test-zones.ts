import {
  evaluateZone,
  sellableShares,
  zoneBuyFactor,
  zoneWarnings,
  distanceToZonePct,
  describeZone,
  BUY_MIN_FACTOR,
  NO_ZONE_FACTOR,
  type ZoneEntry,
} from "../lib/calculations/zones";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

function entry(p: Partial<ZoneEntry>): ZoneEntry {
  return { symbol: "X", buyZoneLow: null, buyZoneHigh: null, sellZoneLow: null, sellZoneHigh: null, minHoldingShares: 0, ...p };
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
  ok("open-ended sell: 5000 is sell", evaluateZone(5000, entry({ sellZoneLow: 100 })).status === "sell");
}

console.log("\n=== unknown price is never a signal ===");
{
  const e = entry({ buyZoneHigh: 50 });
  ok("price 0 is unknown, not cheap", evaluateZone(0, e).status === "unknown");
  ok("null price is unknown", evaluateZone(null, e).status === "unknown");
  ok("NaN price is unknown", evaluateZone(NaN, e).status === "unknown");
  ok("negative price is unknown", evaluateZone(-12, e).status === "unknown");
  ok("no bands at all is no_zone", evaluateZone(45, entry({})).status === "no_zone");
}

console.log("\n=== contradictory config yields no instruction ===");
{
  const overlap = entry({ buyZoneHigh: 100, sellZoneLow: 90 });
  const v = evaluateZone(95, overlap);
  ok("overlapping bands are a conflict", v.status === "conflict", `status=${v.status}`);
  ok("conflict explains itself", v.warnings.length > 0 && v.warnings[0].includes("sell zone starts"));
  ok("touching bands are a conflict", evaluateZone(50, entry({ buyZoneHigh: 50, sellZoneLow: 50 })).status === "conflict");
  ok("inverted buy band is a conflict", evaluateZone(45, entry({ buyZoneLow: 60, buyZoneHigh: 50 })).status === "conflict");
  ok("inverted sell band is a conflict", evaluateZone(110, entry({ sellZoneLow: 120, sellZoneHigh: 100 })).status === "conflict");
  ok("negative zone price is rejected", zoneWarnings(entry({ buyZoneHigh: -5 })).length > 0);
  ok("a conflict is flagged even with no price", evaluateZone(null, overlap).status === "conflict");
  ok("negative minimum holding is rejected", zoneWarnings(entry({ minHoldingShares: -5 })).length > 0);
}

console.log("\n=== MINIMUM HOLDING: only the excess is ever sold ===");
{
  // The owner's rule, in his own numbers: floor 1,000, holding 1,200 -> sell 200.
  ok("1200 held, keep 1000 -> sell 200", sellableShares("sell", 1200, 1000) === 200, `${sellableShares("sell", 1200, 1000)}`);
  ok("1000 held, keep 1000 -> sell nothing", sellableShares("sell", 1000, 1000) === 0);
  ok("900 held, keep 1000 -> sell nothing (already under the core)", sellableShares("sell", 900, 1000) === 0);
  ok("1001 held, keep 1000 -> sell 1", sellableShares("sell", 1001, 1000) === 1);
  ok("no floor set -> the whole position is sellable", sellableShares("sell", 545, 0) === 545);
  ok("holding nothing sells nothing", sellableShares("sell", 0, 0) === 0);
  ok("negative holding sells nothing", sellableShares("sell", -5, 0) === 0);
  ok("NaN floor is treated as no floor", sellableShares("sell", 5, NaN) === 5);
  // Whole shares only, even if the recorded balance carries a fractional tail.
  ok("fractional excess floors down", sellableShares("sell", 1200.9, 1000) === 200);
  // Only a sell-zone price frees anything.
  ok("buy status frees nothing", sellableShares("buy", 1200, 1000) === 0);
  ok("between frees nothing", sellableShares("between", 1200, 1000) === 0);
  ok("conflict frees nothing", sellableShares("conflict", 1200, 1000) === 0);
  ok("unknown price frees nothing", sellableShares("unknown", 1200, 1000) === 0);
  ok("no_zone frees nothing", sellableShares("no_zone", 1200, 1000) === 0);
}

console.log("\n=== how hard to buy, by distance from the band ===");
{
  const e = entry({ buyZoneLow: 40, buyZoneHigh: 50, sellZoneLow: 100 });
  ok("inside the band is full weight", zoneBuyFactor(45, e).factor === 1, zoneBuyFactor(45, e).reason);
  ok("in the sell band buys nothing", zoneBuyFactor(110, e).factor === 0, zoneBuyFactor(110, e).reason);
  // 12.5% above a 50 ceiling = 56.25 -> 1 - 12.5/25 = 0.5
  ok("12.5% above the ceiling halves the weight", near(zoneBuyFactor(56.25, e).factor, 0.5), `${zoneBuyFactor(56.25, e).factor}`);
  // 5% above -> 0.8
  ok("5% above the ceiling is 0.8", near(zoneBuyFactor(52.5, e).factor, 0.8), `${zoneBuyFactor(52.5, e).factor}`);
  const buyOnly = entry({ buyZoneLow: 40, buyZoneHigh: 50 });
  ok("far above the ceiling bottoms out, never negative", zoneBuyFactor(500, buyOnly).factor === BUY_MIN_FACTOR, `${zoneBuyFactor(500, buyOnly).factor}`);
  ok("a price in the sell band outranks the taper", zoneBuyFactor(500, e).factor === 0, zoneBuyFactor(500, e).reason);
  ok("the taper is monotonic", zoneBuyFactor(52, e).factor > zoneBuyFactor(58, e).factor);
  ok("below the band stays full weight (cheaper than planned)", zoneBuyFactor(35, e).factor === 1, zoneBuyFactor(35, e).reason);
  ok("below the band says why", zoneBuyFactor(35, e).reason.includes("cheaper than planned"));
  ok("no buy zone set is reduced, not zero", zoneBuyFactor(45, entry({})).factor === NO_ZONE_FACTOR);
  ok("conflict buys nothing", zoneBuyFactor(95, entry({ buyZoneHigh: 100, sellZoneLow: 90 })).factor === 0);
  ok("no price buys nothing", zoneBuyFactor(null, e).factor === 0);
  ok("every factor stays within 0..1", [10, 35, 45, 52, 70, 110, 5000].every((p) => {
    const f = zoneBuyFactor(p, e).factor;
    return f >= 0 && f <= 1;
  }));
}

console.log("\n=== distance to a band ===");
{
  const e = entry({ buyZoneHigh: 90, sellZoneLow: 110 });
  const d = distanceToZonePct(100, e);
  ok("10% above the buy ceiling", near(d.toBuyPct ?? 0, 10), `toBuy=${d.toBuyPct}`);
  ok("10% below the sell floor", near(d.toSellPct ?? 0, 10), `toSell=${d.toSellPct}`);
  ok("inside the buy band reads negative", (distanceToZonePct(80, e).toBuyPct ?? 0) < 0);
  const none = distanceToZonePct(100, entry({}));
  ok("unset bands give null, not 0", none.toBuyPct === null && none.toSellPct === null);
}

console.log("\n=== zone descriptions never invent a bound ===");
{
  ok("buy with both bounds", describeZone(40, 50, "buy") === "Rs 40–50");
  ok("buy with only a ceiling", describeZone(null, 50, "buy") === "at or under Rs 50");
  ok("no buy zone says so", describeZone(null, null, "buy") === "no buy zone");
  ok("sell with only a floor", describeZone(100, null, "sell") === "at or above Rs 100");
  ok("no sell zone says so", describeZone(null, null, "sell") === "no sell zone");
}

console.log("\n=== the live book, with the owner's real bands ===");
{
  // MEBL: 545 held, buy 500-540, sell at or above 580, keep at least 50.
  const mebl = entry({ symbol: "MEBL", buyZoneLow: 500, buyZoneHigh: 540, sellZoneLow: 580, minHoldingShares: 50 });
  const v = evaluateZone(587.9, mebl);
  ok("MEBL at 587.90 is in the sell band", v.status === "sell");
  ok("MEBL frees 495 of 545 (keeps the 50 core)", sellableShares(v.status, 545, mebl.minHoldingShares) === 495);
  ok("MEBL is not a buy while it is a sell", zoneBuyFactor(587.9, mebl).factor === 0);

  // PTL: 643 held, buy 50-51, sell 55-56, keep 1,000 — the floor exceeds the
  // position, so the sell side must stay silent even inside the band.
  const ptl = entry({ symbol: "PTL", buyZoneLow: 50, buyZoneHigh: 51, sellZoneLow: 55, sellZoneHigh: 56, minHoldingShares: 1000 });
  ok("PTL at 55.50 is in the sell band", evaluateZone(55.5, ptl).status === "sell");
  ok("PTL frees nothing — 643 held is under the 1,000 core", sellableShares("sell", 643, 1000) === 0);
  ok("PTL at 53.65 today is between the bands", evaluateZone(53.65, ptl).status === "between");
  // 53.65 vs a 51 ceiling = 5.2% above -> ~0.79
  const ptlF = zoneBuyFactor(53.65, ptl).factor;
  ok("PTL today buys at reduced weight, not zero", ptlF > 0.7 && ptlF < 0.85, `factor=${ptlF.toFixed(3)}`);

  // MARI: 678.18 vs a 550 ceiling = 23.3% above -> bottoms near the floor.
  const mari = entry({ symbol: "MARI", buyZoneLow: 500, buyZoneHigh: 550, sellZoneLow: 700, minHoldingShares: 100 });
  const mariF = zoneBuyFactor(678.18, mari).factor;
  ok("MARI far above its band is a trickle", mariF <= 0.2, `factor=${mariF.toFixed(3)}`);
  ok("MUREB inside its band is full weight", zoneBuyFactor(899.54, entry({ buyZoneLow: 850, buyZoneHigh: 910 })).factor === 1);
}


console.log("\n=== strict bands: outside the zone, the money waits ===");
{
  const e = { symbol: "X", buyZoneLow: 90, buyZoneHigh: 100, sellZoneLow: 200, sellZoneHigh: null, minHoldingShares: 0 };

  // Inside the band nothing changes: it is a price you said you would pay.
  ok("in the band still buys at full weight", zoneBuyFactor(95, e, true).factor === 1, `${zoneBuyFactor(95, e, true).factor}`);
  ok("below the band still buys at full weight", zoneBuyFactor(80, e, true).factor === 1, `${zoneBuyFactor(80, e, true).factor}`);

  // Above the ceiling is where advisory and binding part company.
  const loose = zoneBuyFactor(110, e, false);
  const strict = zoneBuyFactor(110, e, true);
  ok("advisory mode still trickles money in above the ceiling", loose.factor > 0, `${loose.factor.toFixed(2)}`);
  ok("strict mode buys nothing above the ceiling", strict.factor === 0, `${strict.factor}`);
  ok("and says what it is waiting for", strict.reason.includes("above your buy ceiling"), strict.reason);

  // A name with no band is not in a band.
  const none = { symbol: "Y", buyZoneLow: null, buyZoneHigh: null, sellZoneLow: null, sellZoneHigh: null, minHoldingShares: 0 };
  ok("advisory mode buys an unbanded name lightly", zoneBuyFactor(50, none, false).factor > 0, `${zoneBuyFactor(50, none, false).factor}`);
  ok("strict mode does not buy an unbanded name", zoneBuyFactor(50, none, true).factor === 0, `${zoneBuyFactor(50, none, true).factor}`);

  // The sell band wins in both modes: adding to what you are exiting is incoherent.
  ok("a sell-band price buys nothing either way", zoneBuyFactor(250, e, false).factor === 0 && zoneBuyFactor(250, e, true).factor === 0);
  // A missing price is not a cheap price, in either mode.
  ok("no price buys nothing either way", zoneBuyFactor(null, e, false).factor === 0 && zoneBuyFactor(null, e, true).factor === 0);
  // Strict must never buy MORE than advisory.
  const prices = [50, 80, 90, 95, 100, 105, 120, 180, 250];
  ok(
    "strict is never more aggressive than advisory",
    prices.every((px) => zoneBuyFactor(px, e, true).factor <= zoneBuyFactor(px, e, false).factor + 1e-9),
    prices.map((px) => `${px}:${zoneBuyFactor(px, e, true).factor.toFixed(2)}/${zoneBuyFactor(px, e, false).factor.toFixed(2)}`).join(" ")
  );
  // Default stays advisory, so nobody's behaviour changes without asking.
  ok("the default is advisory", zoneBuyFactor(110, e).factor === zoneBuyFactor(110, e, false).factor);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
