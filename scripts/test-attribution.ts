// Attribution tests — the period change split by holding.
// Run: npx tsx scripts/test-attribution.ts

import { computeAttribution } from "../lib/calculations/attribution";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}${extra ? "  " + extra : ""}`))
       : (fail++, console.log(`  FAIL ${label}${extra ? "  " + extra : ""}`));
}
function near(a: number, b: number, tol = 0.01) { return Math.abs(a - b) <= tol; }

const series = new Map<string, Array<{ date: string; close: number }>>([
  // Full window: quotes before + inside
  ["MEBL", [
    { date: "2026-06-10", close: 500 },
    { date: "2026-06-16", close: 510 }, // last close BEFORE the window → "then"
    { date: "2026-06-20", close: 520 },
    { date: "2026-07-16", close: 540 },
  ]],
  // Starts INSIDE the window (new data) → partial flag
  ["AHCL", [
    { date: "2026-07-01", close: 14 },
    { date: "2026-07-16", close: 14.5 },
  ]],
  // Only stale quotes before the window → excluded
  ["STALE", [{ date: "2026-05-01", close: 9 }]],
]);

const SINCE = "2026-06-17"; // 30d window start

console.log("period attribution");
const a = computeAttribution({
  positions: [
    { symbol: "MEBL", shares: 10, priceKnown: true, currentPrice: 539.51 },
    { symbol: "AHCL", shares: 100, priceKnown: true, currentPrice: 14.5 },
    { symbol: "STALE", shares: 5, priceKnown: true, currentPrice: 10 },
    { symbol: "NOPX", shares: 5, priceKnown: false, currentPrice: 0 },
    { symbol: "SOLD", shares: 0, priceKnown: true, currentPrice: 99 },
  ],
  series,
  sinceIso: SINCE,
});

const mebl = a.contributions.find((c) => c.symbol === "MEBL")!;
ok("MEBL 'then' = last close BEFORE the window", mebl.thenDate === "2026-06-16" && mebl.priceThen === 510);
ok("MEBL contribution = 10 × (539.51 − 510)", near(mebl.changePkr, 295.1), `${mebl.changePkr.toFixed(2)}`);
ok("MEBL pct = 5.79%", near(mebl.pricePct * 100, 5.79, 0.01), `${(mebl.pricePct * 100).toFixed(2)}`);
ok("MEBL full window", mebl.partialWindow === false);

const ahcl = a.contributions.find((c) => c.symbol === "AHCL")!;
ok("AHCL uses first in-window close", ahcl.priceThen === 14 && ahcl.thenDate === "2026-07-01");
ok("AHCL flagged partial (no data back to window start)", ahcl.partialWindow === true);
ok("AHCL contribution 100 × 0.5", near(ahcl.changePkr, 50));

console.log("\nhonest exclusions — never a guessed start price");
ok("stale-series symbol excluded", a.excluded.some((e) => e.symbol === "STALE" && /window/.test(e.reason)));
ok("unpriced symbol excluded", a.excluded.some((e) => e.symbol === "NOPX" && /current price/.test(e.reason)));
ok("sold-out position simply skipped", !a.contributions.some((c) => c.symbol === "SOLD") && !a.excluded.some((e) => e.symbol === "SOLD"));

console.log("\ntotals + ordering");
ok("sorted by absolute impact", Math.abs(a.contributions[0].changePkr) >= Math.abs(a.contributions[1].changePkr));
ok("total = sum of contributions", near(a.totalChangePkr, 295.1 + 50), `${a.totalChangePkr.toFixed(2)}`);

console.log("\nempty inputs stay calm");
const empty = computeAttribution({ positions: [], series: new Map(), sinceIso: SINCE });
ok("no positions → empty result", empty.contributions.length === 0 && empty.totalChangePkr === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
