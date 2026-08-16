import { planKeepPct } from "../lib/calculations/keep-model";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}  ${d}`); };

console.log("=== nearest whole share wins ===");
{
  // 100 shares, keep 76.4% → ideal sell 23.6. Sell 23 keeps 77%, sell 24 keeps 76%.
  // 76% misses by 0.4, 77% by 0.6 → sell 24.
  const p = planKeepPct(100, 76.4)!;
  ok("sell 24 of 100 for keep 76.4%", p.sellShares === 24, `sell=${p.sellShares}`);
  ok("keeps 76 shares", p.keepShares === 76, `keep=${p.keepShares}`);
  ok("actual 76%", Math.abs(p.actualKeepPct - 76) < 1e-9, `actual=${p.actualKeepPct}`);
}
{
  // 12 shares, keep a third → ideal sell 8.0004. Sell 8 keeps 33.33%, sell 9 keeps 25%.
  const p = planKeepPct(12, 33.33)!;
  ok("sell 8 of 12 for keep 33.33%", p.sellShares === 8, `sell=${p.sellShares}`);
}

console.log("\n=== exact landings stay exact ===");
{
  // 545 shares (a real position size), keep 60% → 218 is exact.
  const p = planKeepPct(545, 60)!;
  ok("sell 218 of 545", p.sellShares === 218, `sell=${p.sellShares}`);
  ok("actual exactly 60%", Math.abs(p.actualKeepPct - 60) < 1e-9, `actual=${p.actualKeepPct}`);
}

console.log("\n=== a dead-even tie sells fewer ===");
{
  // 37 shares, keep 50% → ideal sell 18.5. Both neighbours miss by 1.351pp.
  const p = planKeepPct(37, 50)!;
  ok("tie sells 18, not 19", p.sellShares === 18, `sell=${p.sellShares}`);
  ok("keeps 19 (51.35%)", p.keepShares === 19 && Math.abs(p.actualKeepPct - (19 / 37) * 100) < 1e-9, `actual=${p.actualKeepPct}`);
}

console.log("\n=== edges ===");
{
  const all = planKeepPct(37, 0)!;
  ok("keep 0% sells all", all.sellShares === 37 && all.keepShares === 0, `sell=${all.sellShares}`);
  const none = planKeepPct(37, 100)!;
  ok("keep 100% sells none", none.sellShares === 0 && Math.abs(none.actualKeepPct - 100) < 1e-9, `sell=${none.sellShares}`);
  const one = planKeepPct(1, 99)!;
  ok("1 share, keep 99% → keep the share", one.sellShares === 0, `sell=${one.sellShares}`);
  const oneLow = planKeepPct(1, 49)!;
  ok("1 share, keep 49% → sell it", oneLow.sellShares === 1, `sell=${oneLow.sellShares}`);
  const oneTie = planKeepPct(1, 50)!;
  ok("1 share, keep 50% is a tie → keep it", oneTie.sellShares === 0, `sell=${oneTie.sellShares}`);
}

console.log("\n=== clamping and invalid input ===");
{
  const over = planKeepPct(100, 150)!;
  ok("target >100 clamps to keep all", over.sellShares === 0 && over.targetKeepPct === 100, `sell=${over.sellShares} target=${over.targetKeepPct}`);
  const under = planKeepPct(100, -5)!;
  ok("target <0 clamps to sell all", under.sellShares === 100 && under.targetKeepPct === 0, `sell=${under.sellShares}`);
  ok("zero shares → null", planKeepPct(0, 50) === null);
  ok("negative shares → null", planKeepPct(-3, 50) === null);
  ok("NaN target → null", planKeepPct(100, NaN) === null);
  ok("Infinity target → null", planKeepPct(100, Infinity) === null);
  ok("NaN shares → null", planKeepPct(NaN, 50) === null);
}

console.log("\n=== fractional holdings sell whole shares only ===");
{
  // An odd data tail (e.g. from a split) can leave a fractional balance; the
  // sell quantity must still be a whole number and never exceed the balance.
  const p = planKeepPct(100.5, 0)!;
  ok("sell 100 of 100.5", p.sellShares === 100, `sell=${p.sellShares}`);
  ok("keeps the 0.5 tail", Math.abs(p.keepShares - 0.5) < 1e-9, `keep=${p.keepShares}`);
  ok("actual ≈ 0.4975%", Math.abs(p.actualKeepPct - (0.5 / 100.5) * 100) < 1e-9, `actual=${p.actualKeepPct}`);
}

console.log("\n=== whole-share and bounds invariants across a sweep ===");
{
  let violations = 0;
  for (const total of [1, 2, 3, 7, 12, 23, 37, 100, 107, 133, 178, 316, 545, 643, 19139]) {
    for (let k = 0; k <= 100; k += 0.7) {
      const p = planKeepPct(total, k);
      if (!p) { violations++; continue; }
      if (p.sellShares !== Math.floor(p.sellShares)) violations++;
      if (p.sellShares < 0 || p.sellShares > total) violations++;
      // No other whole-share quantity may land closer to the target than the chosen one.
      for (const alt of [p.sellShares - 1, p.sellShares + 1]) {
        if (alt < 0 || alt > Math.floor(total)) continue;
        const altPct = ((total - alt) / total) * 100;
        if (Math.abs(altPct - p.targetKeepPct) < Math.abs(p.actualKeepPct - p.targetKeepPct) - 1e-9) violations++;
      }
    }
  }
  ok("sweep: whole shares, in bounds, and always the nearest landing", violations === 0, `violations=${violations}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
