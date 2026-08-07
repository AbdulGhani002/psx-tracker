// Zakat engine tests.
// Run: npx tsx scripts/test-zakat.ts

import {
  computeZakat, pkrPerGram,
  GOLD_NISAB_GRAMS, SILVER_NISAB_GRAMS, GRAMS_PER_TOLA, TROY_OZ_GRAMS,
} from "../lib/calculations/zakat";

let pass = 0;
let fail = 0;
function near(label: string, got: number | null, want: number | null, tol = 0.01) {
  const ok = got === null || want === null ? got === want : Math.abs(got - want) <= tol;
  ok ? (pass++, console.log(`  ok   ${label} = ${got === null ? "null" : got.toFixed(2)}`))
     : (fail++, console.log(`  FAIL ${label}: got ${got}, want ${want}`));
}
function is(label: string, got: unknown, want: unknown) {
  got === want ? (pass++, console.log(`  ok   ${label} = ${JSON.stringify(got)}`))
               : (fail++, console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
}

console.log("nisab constants (7.5 / 52.5 tola at 11.6638 g)");
near("tola", GRAMS_PER_TOLA, 11.6638, 0.0001);
near("gold nisab grams", GOLD_NISAB_GRAMS, 87.4785, 0.0001);
near("silver nisab grams", SILVER_NISAB_GRAMS, 612.3495, 0.0001);

console.log("\nPKR per gram from a USD/oz quote (troy ounce, not avoirdupois)");
// 38 USD/oz silver × 277.9732 PKR/USD ÷ 31.1034768 g/ozt
near("silver 38/oz @277.9732", pkrPerGram(38, 277.9732), 339.61, 0.01);
is("null price → null", pkrPerGram(null, 277.9732), null);
is("null fx → null", pkrPerGram(38, null), null);
is("zero price → null", pkrPerGram(0, 277.9732), null);
near("troy oz grams", TROY_OZ_GRAMS, 31.1034768, 0.0000001);

const CATS = [
  { key: "cash", label: "Brokerage cash", amount: 50_000, included: true },
  { key: "savings", label: "Bank savings", amount: 150_000, included: true },
  { key: "funds", label: "Mutual funds", amount: 40_242, included: true },
  { key: "stocks", label: "Listed shares", amount: 300_000, included: true },
];

console.log("\nabove nisab → 2.5% of the net base");
const r = computeZakat({ categories: CATS, liabilitiesPkr: 40_242, silverPkrPerGram: 340, goldPkrPerGram: 30_000 });
near("zakatable total", r.zakatableTotal, 540_242);
near("net base after liabilities", r.netBase, 500_000);
near("silver nisab (operative)", r.nisabSilverPkr, 612.3495 * 340, 0.01);
near("gold nisab (reference)", r.nisabGoldPkr, 87.4785 * 30_000, 0.01);
is("above nisab", r.aboveNisab, true);
near("due = 2.5%", r.duePkr, 12_500);
near("rate", r.ratePct, 2.5);

console.log("\nbelow nisab → zero due, stated plainly");
const below = computeZakat({
  categories: [{ key: "cash", label: "Cash", amount: 100_000, included: true }],
  liabilitiesPkr: 0, silverPkrPerGram: 340, goldPkrPerGram: null,
});
is("below nisab", below.aboveNisab, false);
near("due 0", below.duePkr, 0);

console.log("\nno silver price → NO verdict (never guess the threshold)");
const unk = computeZakat({ categories: CATS, liabilitiesPkr: 0, silverPkrPerGram: null, goldPkrPerGram: 30_000 });
is("aboveNisab unknown", unk.aboveNisab, null);
is("due unknown", unk.duePkr, null);
near("gold reference still shown", unk.nisabGoldPkr, 87.4785 * 30_000, 0.01);

console.log("\nexclusions and edge cases");
const excl = computeZakat({
  categories: [
    { key: "cash", label: "Cash", amount: 800_000, included: true },
    { key: "stocks", label: "Long-term shares (AAOIFI view)", amount: 500_000, included: false },
  ],
  liabilitiesPkr: 0, silverPkrPerGram: 340, goldPkrPerGram: null,
});
near("excluded category ignored", excl.zakatableTotal, 800_000);
const neg = computeZakat({
  categories: [{ key: "cash", label: "Cash", amount: 100_000, included: true }],
  liabilitiesPkr: 999_999, silverPkrPerGram: 340, goldPkrPerGram: null,
});
near("liabilities floor the base at 0", neg.netBase, 0);
near("due 0 at floor", neg.duePkr, 0);
const negAmt = computeZakat({
  categories: [
    { key: "a", label: "A", amount: -5_000, included: true },
    { key: "b", label: "B", amount: 10_000, included: true },
  ],
  liabilitiesPkr: 0, silverPkrPerGram: 340, goldPkrPerGram: null,
});
near("negative amounts don't reduce the base", negAmt.zakatableTotal, 10_000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
