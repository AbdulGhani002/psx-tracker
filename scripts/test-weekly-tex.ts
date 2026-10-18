// The weekly plan's LaTeX (lib/statement/weekly-template): the strategy
// section and the month's rates, escaped; nothing when there is no strategy.
//
//   npx tsx scripts/test-weekly-tex.ts                 # checks only
//   npx tsx scripts/test-weekly-tex.ts --out week.tex  # also writes the full fixture

import { writeFileSync } from "node:fs";
import { buildWeeklyTex, type WeeklyReportData } from "../lib/statement/weekly-template";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const base: WeeklyReportData = {
  weekKey: "FY26-27-W15",
  weekLabel: "week 15 of FY26-27, 11 October 2026",
  generatedOn: "2026-10-11",
  regimeBand: "neutral",
  regimeLabel: "Neutral",
  regimeLine: "Mixed signals: hold the floor, buy only at your levels.",
  rawScore: 1,
  maxScore: 8,
  confidence: "Medium",
  cashFloorPct: 15,
  favour: ["banks", "E&P"],
  avoid: ["cement"],
  signals: [{ label: "Real rate", source: "auto", score: 1, reading: "Policy 11.5% vs CPI 11.2%: about 0.3 pts real", known: true }],
  missing: [],
  netWorth: 2_065_474,
  equityValue: 2_065_474,
  cashAvailable: 0,
  cashReceivable: 0,
  cashExpected: 0,
  cashPct: 0,
  cashCheckLine: "Below the floor.",
  cashCheckOk: false,
  fundEarnedWeek: 0,
  fundEarnedPerDay: 0,
  cashPlaces: [{ label: "MCB Cash Management Optimizer", pkr: 101000, yieldPct: 10.25 }],
  cashLocked: [{ label: "Bank Alfalah FD", pkr: 10000, until: "2027-01-12" }],
  gateLine: null,
  poolCutLine: null,
  indexName: "KSE-100",
  indexLevel: 170_511,
  indexAsOf: "10 Oct",
  ladderAction: "WAIT",
  ladderLine: "No rung reached.",
  rungs: [],
  ladderWarnings: [],
  positions: [{ symbol: "MEBL", weightPct: 21.8, value: 450_000, priceKnown: true }],
  parked: [],
  strategy: {
    steps: ["Market: Correction, KSE-100 11.5% below its high", "Stocks earn 12%, T-bills 12%: fair", "Stocks 100%, above the 60% target: no buying", "New cash: 6-month T-bills (10.1% after tax)", "Buy: BOP, MARI, INDU, ILP, CHCC, FABL", "Reconsider: PTL, CSAP"],
    zones: [
      { range: "163,400–166,850", why: "Model, next 20 days", reached: false },
      { range: "152,050–157,300", why: "Past lows, Mar 26 and Jun 26 · Cheap against T-bills", reached: false },
      { range: "139,250–149,600", why: "A bad quarter, 1 in 20", reached: false },
    ],
    rates: { label: "October 2026, not entered", values: [["Policy", 11.5], ["T-bill 3M", 11.5992], ["6M", 11.899], ["12M", 11.99], ["Sukuk", 11.8], ["Money market", 10.45], ["Savings", null], ["CPI", 11.15]] },
  },
};

const tex = buildWeeklyTex(base);
check("a strategy section", tex.includes("{\\large\\bfseries Strategy}"));
check("each step a line, its % escaped", tex.includes("\\textbullet\\ Market: Correction, KSE-100 11.5\\% below its high\\par") && tex.includes("\\textbullet\\ Stocks 100\\%, above the 60\\% target: no buying\\par"));
check("the buy zones, numbered, with why, dashes and dots safe for LaTeX", tex.includes("Buy zones: 1) 163,400--166,850 Model, next 20 days; 2) 152,050--157,300 Past lows, Mar 26 and Jun 26 / Cheap against T-bills; 3) 139,250--149,600 A bad quarter, 1 in 20.") && !tex.includes("–") && !tex.includes("·"));
const reached = buildWeeklyTex({ ...base, strategy: { ...base.strategy!, zones: [{ range: "160,000–165,000", why: "Past lows", reached: true }] } });
check("a reached zone says so", reached.includes("1) 160,000--165,000 Past lows, reached."));
check("the rates: one column each, two decimals, a gap as ---", tex.includes("\\begin{tabular}{@{}rrrrrrrr@{}}") && tex.includes("11.50\\% & 11.60\\% & 11.90\\% & 11.99\\% & 11.80\\% & 10.45\\% & --- & 11.15\\%"));
check("the rates' month, and that they were not entered", tex.includes("Rates, October 2026, not entered"));
check("the strategy comes before the regime", tex.indexOf("bfseries Strategy") < tex.indexOf("bfseries Regime"));
check("an ampersand in the favour list is escaped", tex.includes("E\\&P"));
const none = buildWeeklyTex({ ...base, strategy: null });
check("no strategy: no section", !none.includes("bfseries Strategy") && none.includes("bfseries Regime"));
const noRates = buildWeeklyTex({ ...base, strategy: { ...base.strategy!, rates: null } });
check("no rates: steps without the table", noRates.includes("bfseries Strategy") && !noRates.includes("Rates, "));

const out = process.argv.indexOf("--out");
if (out > 0 && process.argv[out + 1]) {
  writeFileSync(process.argv[out + 1], tex);
  console.log(`wrote ${process.argv[out + 1]}`);
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
