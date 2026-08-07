// Next-rupee ladder tests.
// Oracle: the real July-2026 numbers verified live — SBP 12M T-bill cut-off
// 11.488%, the user's funds at 10.28% / 9.32% (MUFAP), PBS CPI YoY 11.0709%.
// Run: npx tsx scripts/test-ladder.ts

import { buildLadder } from "../lib/calculations/ladder";
import { whtPct, afterTaxPct, realPct } from "../lib/calculations/pk-tax";

let pass = 0;
let fail = 0;
function near(label: string, got: number | null, want: number | null, tol = 0.01) {
  const ok = got === null || want === null ? got === want : Math.abs(got - want) <= tol;
  ok ? (pass++, console.log(`  ok   ${label} = ${got === null ? "null" : got.toFixed(3)}`))
     : (fail++, console.log(`  FAIL ${label}: got ${got}, want ${want}`));
}
function is(label: string, got: unknown, want: unknown) {
  got === want ? (pass++, console.log(`  ok   ${label} = ${JSON.stringify(got)}`))
               : (fail++, console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
}

const INF = 11.070941905880094;
const FILER = { filerStatus: "filer", dividendWhtFiler: 15, dividendWhtNonFiler: 30, cgtRateFiler: 15, cgtRateNonFiler: 20, podWhtFiler: 15, podWhtNonFiler: 35 };
const NONFILER = { ...FILER, filerStatus: "non-filer" };

console.log("pk-tax: each instrument gets ITS OWN haircut");
is("T-bill filer WHT", whtPct("profit-on-debt", FILER), 15);
is("T-bill non-filer WHT", whtPct("profit-on-debt", NONFILER), 35);
is("fund dividend non-filer WHT", whtPct("dividend", NONFILER), 30);
near("after-tax 11.488 @15%", afterTaxPct(11.488, "profit-on-debt", FILER), 9.7648, 0.0001);
near("Fisher real of that", realPct(9.7648, INF), -1.176, 0.005);

console.log("\nthe ladder reproduces the verified real-return table");
const ladder = buildLadder({
  inflationPct: INF,
  settings: FILER,
  tbill12mPct: 11.488,
  policyRatePct: 11.5,
  kibor12BidPct: 11.4,
  funds: [
    { name: "MCB Cash Management Optimizer", yieldPct: 10.28 },
    { name: "Alhamra Daily Dividend Fund", yieldPct: 9.32 },
  ],
  savings: [],
  equity: null,
});
const byKey = (k: string) => ladder.rungs.find((r) => r.key.startsWith(k))!;
near("T-bill real after tax", byKey("tbill").realAfterTaxPct, -1.18, 0.01);
near("MCB real after tax", byKey("fund:MCB").realAfterTaxPct, -2.10, 0.01);
near("Alhamra real after tax", byKey("fund:Alhamra").realAfterTaxPct, -2.84, 0.01);
near("T-bill real nominal", byKey("tbill").realNominalPct, 0.38, 0.01);

console.log("\nranked by what SURVIVES, best first");
is("T-bill outranks both funds", ladder.rungs[0].key, "tbill");
is("Alhamra ranks last", ladder.rungs[ladder.rungs.length - 1].key.startsWith("fund:Alhamra"), true);
is("references are not ranked as rungs", ladder.references.length, 2);
is("equity omitted with a reason", ladder.omitted.some((o) => o.label === "Your equities"), true);

console.log("\nequity taxes its two parts under different sections");
const withEq = buildLadder({
  inflationPct: INF, settings: FILER, tbill12mPct: 11.488, policyRatePct: 11.5, kibor12BidPct: null,
  funds: [], savings: [{ name: "Alfa savings", ratePercent: 10.5 }],
  equity: { label: "Your equities", earningsYieldPct: 12, dividendYieldPct: 6 },
});
const eq = withEq.rungs.find((r) => r.key === "equity")!;
// 6% dividends @15% + 6% retained @15% CGT = 10.2 after tax
near("equity after-tax", eq.afterTaxPct, 10.2, 0.001);
near("equity real after-tax", eq.realAfterTaxPct, -0.78, 0.01);
is("equity ranks above the T-bill", withEq.rungs[0].key, "equity");
is("savings taxed as profit-on-debt", withEq.rungs.find((r) => r.key.startsWith("savings"))!.whtAppliedPct, 15);

console.log("\nnon-filer status changes the whole ranking's numbers");
const nf = buildLadder({
  inflationPct: INF, settings: NONFILER, tbill12mPct: 11.488, policyRatePct: null, kibor12BidPct: null,
  funds: [], savings: [], equity: null,
});
near("non-filer T-bill after tax (35%)", nf.rungs[0].afterTaxPct, 11.488 * 0.65, 0.001);
near("non-filer T-bill real after tax", nf.rungs[0].realAfterTaxPct, -3.24, 0.01);

console.log("\nno inflation feed → no real column, never a guess");
const noInf = buildLadder({
  inflationPct: null, settings: FILER, tbill12mPct: 11.488, policyRatePct: 11.5, kibor12BidPct: null,
  funds: [{ name: "F", yieldPct: 10 }], savings: [], equity: null,
});
is("real after-tax is null", noInf.rungs[0].realAfterTaxPct, null);
is("still sorted by nominal", noInf.rungs[0].key, "tbill");
is("no T-bill feed → omitted with reason", buildLadder({ inflationPct: INF, settings: FILER, tbill12mPct: null, policyRatePct: null, kibor12BidPct: null, funds: [], savings: [], equity: null }).omitted[0].label, "12-month T-bill");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
