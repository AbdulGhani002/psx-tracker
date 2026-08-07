// Gordon-growth income-stream valuation tests.
// Oracle: the AHCL grid worked by hand on a Rs 1.35 base dividend.
// Run: npx tsx scripts/test-gordon.ts

import {
  gordonValue,
  gordonGrid,
  requiredReturnPct,
  defaultRateGrid,
  disclosedValue,
  impliedGrowthPct,
  impliedReturnPct,
} from "../lib/calculations/gordon";
import { robustGrowthPct } from "../lib/calculations/intrinsic";

let pass = 0;
let fail = 0;

function near(label: string, got: number | null, want: number | null, tol = 0.01) {
  const ok =
    got === null || want === null ? got === want : Math.abs(got - want) <= tol;
  if (ok) {
    pass++;
    console.log(`  ok   ${label} = ${got === null ? "null" : got.toFixed(2)}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}: got ${got}, want ${want}`);
  }
}
function is(label: string, got: unknown, want: unknown) {
  if (got === want) {
    pass++;
    console.log(`  ok   ${label} = ${JSON.stringify(got)}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const D0 = 1.35;

// The hand-worked AHCL grid. Every cell must reproduce exactly.
console.log("AHCL grid, D0 = Rs 1.35 (P = D0(1+g)/(r-g))");
const EXPECTED: Record<number, Record<number, number>> = {
  15: { 5: 14.18, 8: 20.83, 10: 29.7, 12: 50.4 },
  16: { 5: 12.89, 8: 18.23, 10: 24.75, 12: 37.8 },
  17: { 5: 11.81, 8: 16.2, 10: 21.21, 12: 30.24 },
  18: { 5: 10.9, 8: 14.58, 10: 18.56, 12: 25.2 },
  20: { 5: 9.45, 8: 12.15, 10: 14.85, 12: 18.9 },
};
for (const rPct of [15, 16, 17, 18, 20]) {
  for (const gPct of [5, 8, 10, 12]) {
    near(`r=${rPct}% g=${gPct}%`, gordonValue(D0, rPct, gPct).value, EXPECTED[rPct][gPct]);
  }
}

console.log("\nthe D0 vs D1 distinction (using D0 alone understates by one year of growth)");
near("r=16 g=5 uses D0(1+g)", gordonValue(D0, 16, 5).value, 12.89);
near("  (D0/(r-g) would have been)", D0 / 0.11, 12.27);

console.log("\ngrid shape matches the hand-worked table");
const grid = gordonGrid(D0, [15, 16, 17, 18, 20], [5, 8, 10, 12]);
is("rows", grid.rows.length, 5);
is("cols", grid.rows[0].length, 4);
near("rows[1][0] == r16/g5", grid.rows[1][0].value, 12.89);

console.log("\nfragile cells are flagged, not hidden (r-g < 4pp)");
is("r=15 g=12 (spread 3pp) fragile", gordonValue(D0, 15, 12).fragile, true);
near("  ...but still shown", gordonValue(D0, 15, 12).value, 50.4);
is("r=17 g=5 (spread 12pp) solid", gordonValue(D0, 17, 5).fragile, false);

console.log("\nno finite answer when g >= r — must be null, never a negative price");
is("g == r", gordonValue(D0, 12, 12).value, null);
is("g > r", gordonValue(D0, 10, 12).value, null);
is("no dividend", gordonValue(0, 17, 5).value, null);

console.log("\nrequired return is built from the LIVE risk-free");
near("SBP 11.5 + ERP 5.5", requiredReturnPct(11.5, 5.5), 17);
is("grid centres on r", JSON.stringify(defaultRateGrid(17)), JSON.stringify([15, 16, 17, 18, 20]));

console.log("\nthe company's own disclosed model (AHCL Level-3, A.F. Ferguson)");
const disclosed = disclosedValue({
  requiredReturnPct: 16,
  growthPct: 5,
  baseDps: 1.35,
  source: "FY25 accounts, Level-3 fair value, signed off by A.F. Ferguson",
  asOf: "2025-06-30",
});
near("AHCL disclosed fair value", disclosed?.value ?? null, 12.89);
is("absent disclosed model -> null (never invented)", disclosedValue(null), null);

console.log("\nwhat does the market already believe? (invert the model)");
// At P = 12.89 and r = 16%, the implied g must round-trip back to 5%.
near("implied g round-trips", impliedGrowthPct(12.89, D0, 16), 5, 0.02);
// At P = 12.89 and g = 5%, the implied r must round-trip back to 16%.
near("implied r round-trips", impliedReturnPct(12.89, D0, 5), 16, 0.02);
is("implied g null when price 0", impliedGrowthPct(0, D0, 16), null);

console.log("\nrobustGrowthPct: loss years consume real time (the CAGR bug)");
// [5,-2,-3,8,9,10] spans 5 years. Counting only the 4 positive years gave 3
// years of span -> 25%. The truth is (10/5)^(1/5)-1 = 14.87%.
near("EPS [5,-2,-3,8,9,10]", robustGrowthPct([5, -2, -3, 8, 9, 10]), 14.87, 0.01);
near("clean series still right", robustGrowthPct([5, 10]), 100 > 25 ? 25 : 25); // clamped to 25
near("flat series", robustGrowthPct([8, 8, 8]), 0);
near("too few points", robustGrowthPct([5]), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
