// Monthly-statement template test: builds the TEX from fixture data covering
// the awkward cases (& in names, negative movers, empty sections, unpriced
// symbols) and — when a tectonic binary is available — compiles it for real.
// Run: npx tsx scripts/test-statement-tex.ts [path-to-tectonic]

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStatementTex, statementMonth, type MonthlyStatementData } from "../lib/statement/template";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}

console.log("statementMonth picks the month that just ended");
const m = statementMonth(new Date("2026-08-01T05:00:00Z"));
ok("key 2026-07", m.key === "2026-07", m.key);
ok("window 01..31 July", m.from === "2026-07-01" && m.to === "2026-07-31");
const mDec = statementMonth(new Date("2026-01-01T05:00:00Z"));
ok("year boundary → 2025-12", mDec.key === "2025-12" && mDec.from === "2025-12-01" && mDec.to === "2025-12-31");

const FIXTURE: MonthlyStatementData = {
  monthLabel: "July 2026",
  monthKey: "2026-07",
  generatedOn: "2026-08-01",
  netWorthTotal: 1_137_002,
  equity: 1_045_000,
  funds: 55_636,
  savingsAndCash: 36_366,
  usdEquivalent: 4_091,
  unrealizedPL: 82_450,
  unrealizedPct: 8.6,
  xirrPct: 68.2,
  realXirrPct: 51.4,
  inflationPct: 11.07,
  movers: [
    { symbol: "AHCL", contribution: 21_500 },
    { symbol: "MARI", contribution: -8_300 },
  ],
  moversPartial: true,
  dividends: [{ symbol: "HUBC", date: "2026-07-10", net: 2_950 }],
  dividendTotal: 2_950,
  trades: [
    { date: "2026-07-21", type: "BUY", symbol: "PAKT", shares: 5, price: 1470.53 },
    { date: "2026-07-30", type: "SELL", symbol: "HUBC", shares: 120, price: 217.76 },
  ],
  decisions: [{ date: "2026-07-30", symbol: "PAKT", action: "sell all", rationale: "Thesis was yield & stability; 100% WHT-heavy payout with no growth — M&P better home" }],
  positions: [
    { symbol: "AHCL", shares: 19_139, value: 277_500, weightPct: 26.5, priceKnown: true },
    { symbol: "D&GKC", shares: 10, value: 0, weightPct: 0, priceKnown: false },
  ],
  unpriced: ["D&GKC"],
  parked: [{ symbol: "LUCK", shares: 6, value: 2_496 }],
};

console.log("\ntemplate builds and escapes");
const tex = buildStatementTex(FIXTURE);
ok("has documentclass", tex.includes("\\documentclass"));
ok("ampersand in rationale escaped", tex.includes("yield \\& stability"));
ok("ampersand in symbol escaped", tex.includes("D\\&GKC"));
ok("unpriced note present", tex.includes("No price for D\\&GKC"));
ok("parked note present", tex.includes("Parked, kept for the companies' reports") && tex.includes("LUCK 6"));
ok("partial-window flag shows", tex.includes("partial window"));
ok("negative mover uses math minus", tex.includes("$-$"));
ok("no unescaped % outside comments", !/[^\\]%[^%]/.test(tex.split("\n").filter((l) => !l.trim().startsWith("%")).join(" ").replace(/\\%/g, "")));

const EMPTY: MonthlyStatementData = {
  ...FIXTURE,
  movers: [], moversPartial: false, dividends: [], dividendTotal: 0, trades: [], decisions: [], unpriced: [], parked: [],
  usdEquivalent: null, xirrPct: null, realXirrPct: null, inflationPct: null, unrealizedPct: null,
};
const texEmpty = buildStatementTex(EMPTY);
ok("empty month still builds", texEmpty.includes("None this month"));
ok("null XIRR prints ---", texEmpty.includes("XIRR ---"));
ok("no parked note when nothing is parked", !texEmpty.includes("Parked,"));

const tectonic = process.argv[2] ?? "C:\\CC\\Code\\tools\\tectonic\\tectonic.exe";
if (existsSync(tectonic)) {
  console.log(`\ncompiling both fixtures with ${tectonic}`);
  const dir = mkdtempSync(join(tmpdir(), "psx-stmt-test-"));
  try {
    for (const [name, t] of [["full", tex], ["empty", texEmpty]] as const) {
      writeFileSync(join(dir, `${name}.tex`), t);
      try {
        execFileSync(tectonic, ["--outdir", dir, join(dir, `${name}.tex`)], { timeout: 240000, stdio: "pipe" });
        ok(`${name} fixture compiles to PDF`, existsSync(join(dir, `${name}.pdf`)));
      } catch (e: any) {
        ok(`${name} fixture compiles to PDF`, false, String(e.stderr ?? e).slice(-400));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log(`\n(skip real compile — no tectonic at ${tectonic})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
