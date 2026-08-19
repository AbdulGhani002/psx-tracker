import { resolveStandIn, planSwap, validateLinks, DEFAULT_FEE_RATE, type StandInLeg } from "../lib/calculations/standin";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

const leg = (p: Partial<StandInLeg>): StandInLeg =>
  ({ symbol: "X", sector: "Commercial Banks", price: 100, shares: 0, marketValue: 0, targetPct: 0, ...p });

console.log("=== the pair shares one target ===");
{
  // MEBL target 12% of a 1,000,000 book = 120,000. 45 MEBL held at 590 = 26,550.
  // ABL standing in: 250 at 178 = 44,500. Combined 71,050, so 48,950 still to fill.
  const g = resolveStandIn({
    primary: leg({ symbol: "MEBL", price: 590, shares: 45, marketValue: 26550, targetPct: 12 }),
    standIn: leg({ symbol: "ABL", price: 178, shares: 250, marketValue: 44500 }),
    primaryInBuyZone: false,
    bookValue: 1_000_000,
  });
  ok("combined value counts both legs", near(g.combinedValue, 71050), `${g.combinedValue}`);
  ok("target belongs to the primary", g.targetPct === 12 && near(g.targetValue, 120000), `${g.targetValue}`);
  ok("gap is measured across the pair", near(g.gapToTarget, 48950), `${g.gapToTarget}`);
  ok("same sector, no complaint", g.sectorMatches && g.warnings.length === 0, g.warnings.join(" | "));
  ok("no swap while the primary is out of its band", g.swapReady === false && g.swap === null);
}
{
  // Once the pair is at target there is nothing left to fill, and the fact that
  // it is mostly the stand-in does not create a new gap.
  const g = resolveStandIn({
    primary: leg({ symbol: "MEBL", price: 590, shares: 0, marketValue: 0, targetPct: 10 }),
    standIn: leg({ symbol: "ABL", price: 178, shares: 600, marketValue: 106800 }),
    primaryInBuyZone: false,
    bookValue: 1_000_000,
  });
  ok("a full stand-in leaves no gap", g.gapToTarget === 0, `${g.gapToTarget}`);
}

console.log("\n=== the swap, when the primary comes into its band ===");
{
  const g = resolveStandIn({
    primary: leg({ symbol: "MEBL", price: 520, shares: 45, marketValue: 23400, targetPct: 12 }),
    standIn: leg({ symbol: "ABL", price: 180, shares: 250, marketValue: 45000 }),
    primaryInBuyZone: true,
    bookValue: 1_000_000,
    gain: 500,
    cgtRatePct: 15,
  });
  ok("swap is flagged ready", g.swapReady === true && g.swap !== null);
  const s = g.swap!;
  ok("sells the whole stand-in", s.sellShares === 250);
  ok("proceeds are qty x price", near(s.proceeds, 45000));
  ok("sell fees at 0.15% + SST", near(s.sellFees, 45000 * DEFAULT_FEE_RATE), `${s.sellFees}`);
  ok("CGT charged on the gain", near(s.cgt ?? -1, 75), `${s.cgt}`);
  ok("net is proceeds less fees and tax", near(s.netFromSale, 45000 - s.sellFees - 75), `${s.netFromSale}`);
  ok("buys whole shares only", Number.isInteger(s.buyShares) && s.buyShares > 0, `${s.buyShares}`);
  ok("the buy fits inside the net proceeds", s.totalOutlay <= s.netFromSale + 1e-9, `${s.totalOutlay} vs ${s.netFromSale}`);
  ok("leftover is under one share plus its fee", s.leftover < 520 * (1 + DEFAULT_FEE_RATE), `${s.leftover}`);
  ok("shortfall against the pair target is reported", s.shortfall > 0, `${s.shortfall}`);
}
{
  // No gain figure available: report the swap but never invent the tax.
  const s = planSwap({ standInShares: 100, standInPrice: 200, primaryPrice: 500, gain: null, cgtRatePct: 15 })!;
  ok("unknown gain leaves CGT null, not zero", s.gain === null && s.cgt === null);
  ok("net is then just proceeds less brokerage", near(s.netFromSale, 20000 - 20000 * DEFAULT_FEE_RATE));
}
{
  // A loss on the stand-in is not taxed.
  const s = planSwap({ standInShares: 100, standInPrice: 200, primaryPrice: 500, gain: -3000, cgtRatePct: 15 })!;
  ok("a realised loss attracts no CGT", s.cgt === 0, `${s.cgt}`);
}
{
  // A gain larger than the proceeds needs a negative cost basis, so it is
  // capped — otherwise the tax could exceed the payout and the swap would
  // "settle" with money that never existed.
  const s = planSwap({ standInShares: 1, standInPrice: 1, primaryPrice: 1, gain: 1000, cgtRatePct: 15 })!;
  ok("gain is capped at the proceeds", s.gain === 1, `${s.gain}`);
  ok("net proceeds stay positive", s.netFromSale > 0, `${s.netFromSale}`);
  ok("leftover is never negative", s.leftover >= 0, `${s.leftover}`);
}

console.log("\n=== the swap never spends money it does not have ===");
{
  for (const [sellPx, buyPx, qty] of [[178.26, 589.7, 250], [53.65, 1004, 643], [900, 15.5, 25], [1, 1, 1]] as Array<[number, number, number]>) {
    const s = planSwap({ standInShares: qty, standInPrice: sellPx, primaryPrice: buyPx, gain: 1000, cgtRatePct: 15 })!;
    const overspent = s.totalOutlay > s.netFromSale + 1e-9;
    const couldFitMore = s.netFromSale - s.totalOutlay >= buyPx * (1 + DEFAULT_FEE_RATE);
    ok(
      `sell ${qty}@${sellPx} -> buy @${buyPx}: fits and is maximal`,
      !overspent && !couldFitMore,
      `buy ${s.buyShares}, outlay ${s.totalOutlay}, net ${s.netFromSale}`
    );
  }
}
{
  const tiny = planSwap({ standInShares: 1, standInPrice: 10, primaryPrice: 5000 });
  ok("proceeds too small for one share buys none", tiny!.buyShares === 0 && tiny!.buyCost === 0);
  ok("and the cash is reported as leftover", near(tiny!.leftover, tiny!.netFromSale));
}

console.log("\n=== unusable input is refused, never guessed ===");
{
  ok("no stand-in shares -> no plan", planSwap({ standInShares: 0, standInPrice: 100, primaryPrice: 200 }) === null);
  ok("no stand-in price -> no plan", planSwap({ standInShares: 10, standInPrice: 0, primaryPrice: 200 }) === null);
  ok("no primary price -> no plan", planSwap({ standInShares: 10, standInPrice: 100, primaryPrice: 0 }) === null);
  ok("NaN price -> no plan", planSwap({ standInShares: 10, standInPrice: NaN, primaryPrice: 200 }) === null);
  const g = resolveStandIn({
    primary: leg({ symbol: "MEBL", price: null, shares: 0, marketValue: 0, targetPct: 12 }),
    standIn: leg({ symbol: "ABL", price: 178, shares: 250, marketValue: 44500 }),
    primaryInBuyZone: true,
    bookValue: 1_000_000,
  });
  ok("in the band but unpriced: no swap, and it says why", g.swap === null && g.warnings.some((w) => w.includes("live price is missing")));
}

console.log("\n=== config mistakes are caught ===");
{
  const cross = resolveStandIn({
    primary: leg({ symbol: "MEBL", sector: "Commercial Banks", targetPct: 12 }),
    standIn: leg({ symbol: "LUCK", sector: "Cement", shares: 10, marketValue: 4000 }),
    primaryInBuyZone: false,
    bookValue: 1_000_000,
  });
  ok("a cross-sector stand-in is flagged", !cross.sectorMatches && cross.warnings.some((w) => w.includes("different sectors")));

  const doubled = resolveStandIn({
    primary: leg({ symbol: "MEBL", targetPct: 12 }),
    standIn: leg({ symbol: "ABL", targetPct: 5, shares: 10, marketValue: 1780 }),
    primaryInBuyZone: false,
    bookValue: 1_000_000,
  });
  ok("a stand-in with its own target is flagged", doubled.warnings.some((w) => w.includes("double-counting")));

  const noTarget = resolveStandIn({
    primary: leg({ symbol: "MEBL", targetPct: 0 }),
    standIn: leg({ symbol: "ABL", shares: 10, marketValue: 1780 }),
    primaryInBuyZone: false,
    bookValue: 1_000_000,
  });
  ok("a primary with no target is flagged", noTarget.warnings.some((w) => w.includes("no target weight")));
}

console.log("\n=== link sets that cannot mean anything ===");
{
  ok("a clean link passes", validateLinks([{ standIn: "ABL", primary: "MEBL" }]).length === 0);
  ok("self-reference is rejected", validateLinks([{ standIn: "ABL", primary: "ABL" }]).length > 0);
  ok(
    "one stand-in for two primaries is rejected",
    validateLinks([{ standIn: "ABL", primary: "MEBL" }, { standIn: "ABL", primary: "HBL" }]).some((p) => p.includes("only hold one place"))
  );
  ok(
    "two stand-ins for one primary is rejected",
    validateLinks([{ standIn: "ABL", primary: "MEBL" }, { standIn: "HBL", primary: "MEBL" }]).some((p) => p.includes("double-count"))
  );
  ok(
    "a chain is rejected",
    validateLinks([{ standIn: "A", primary: "B" }, { standIn: "B", primary: "C" }]).some((p) => p.includes("Chains"))
  );
  ok(
    "a two-way cycle is rejected",
    validateLinks([{ standIn: "A", primary: "B" }, { standIn: "B", primary: "A" }]).length > 0
  );
  ok("case is normalised", validateLinks([{ standIn: "abl", primary: "ABL" }]).length > 0);
}

console.log("\n=== the live case: ABL standing in for MEBL ===");
{
  // 250 ABL at 178.26 held against MEBL at 587.90, MEBL target 12% of a
  // 978,000 book. MEBL is above its band today, so the pair just holds.
  const holding = resolveStandIn({
    primary: leg({ symbol: "MEBL", price: 587.9, shares: 45, marketValue: 26455.5, targetPct: 12 }),
    standIn: leg({ symbol: "ABL", price: 178.26, shares: 250, marketValue: 44565 }),
    primaryInBuyZone: false,
    bookValue: 978000,
  });
  ok("today it simply holds — no swap", !holding.swapReady && holding.swap === null);
  ok("the pair reads as one 12% allocation", near(holding.targetValue, 117360), `${holding.targetValue}`);
  ok("combined 71,020 of it is filled", near(holding.combinedValue, 71020.5), `${holding.combinedValue}`);

  // MEBL falls into its 500-540 band: reverse the position.
  const swapping = resolveStandIn({
    primary: leg({ symbol: "MEBL", price: 535, shares: 45, marketValue: 24075, targetPct: 12 }),
    standIn: leg({ symbol: "ABL", price: 178.26, shares: 250, marketValue: 44565 }),
    primaryInBuyZone: true,
    bookValue: 978000,
    gain: 0,
    cgtRatePct: 15,
  });
  const s = swapping.swap!;
  ok("the swap fires", swapping.swapReady && s.sellShares === 250);
  ok("250 ABL buys 83 MEBL", s.buyShares === 83, `${s.buyShares} shares, outlay ${s.totalOutlay}, net ${s.netFromSale}`);
  ok("and it is affordable", s.totalOutlay <= s.netFromSale);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
