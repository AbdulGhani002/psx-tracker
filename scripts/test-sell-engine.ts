// Sell-discipline engine tests — every trigger, every guard.
// Run: npx tsx scripts/test-sell-engine.ts

import {
  evaluateTriggers, cyclicalPeakFires, opportunitySpreadPct, cashConversion,
  equityAfterTaxReturnPct, detectCostAnchoring, detectEscalation, detectThesisDrift,
  cashFlags, rebuyFlags, triggerSuppressed,
  type PositionSignal, type EngineConfig,
} from "../lib/calculations/sell-engine";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}
function near(a: number | null, b: number, tol = 0.01) { return a != null && Math.abs(a - b) <= tol; }

const FILER = { filerStatus: "filer", dividendWhtFiler: 15, dividendWhtNonFiler: 30, cgtRateFiler: 15, cgtRateNonFiler: 20, podWhtFiler: 15, podWhtNonFiler: 35 };
const CFG: EngineConfig = { settings: FILER, netRiskFreePct: 8.74, cashConversionWeak: 0.7, cyclicalEpsPeakRatio: 0.85 };

const BASE: PositionSignal = {
  symbol: "TEST", classification: "", price: 100, avgCost: 80, weightPct: 10,
  fairValueHigh: null, fairValueLow: null, fairValueBase: null, invalidatorsOccurred: [],
  earningsYieldPct: null, dividendYieldPct: null, peTtm: null, sectorMedianPe: null,
  epsLatest: null, epsMax5y: null, rateDirection: "unknown", cumOcf3y: null, cumPat3y: null,
  monthsHeld: null, timeStopMonths: 0,
};

console.log("price ceiling — pre-committed, fires at YOUR number");
ok("fires at ceiling", evaluateTriggers({ ...BASE, fairValueHigh: 53, price: 53 }, CFG).some((t) => t.type === "price_target"));
ok("fires above ceiling", evaluateTriggers({ ...BASE, fairValueHigh: 53, price: 60 }, CFG).some((t) => t.type === "price_target"));
ok("silent below ceiling", !evaluateTriggers({ ...BASE, fairValueHigh: 53, price: 52.9 }, CFG).some((t) => t.type === "price_target"));
ok("silent with no plan (never guessed)", !evaluateTriggers({ ...BASE, price: 999 }, CFG).some((t) => t.type === "price_target"));

console.log("\nthesis broken — one card per occurred invalidator");
const tb = evaluateTriggers({ ...BASE, invalidatorsOccurred: ["FY OCF negative two years running", "gross margin < 10%"] }, CFG);
ok("two invalidators → two cards", tb.filter((t) => t.type === "thesis_broken").length === 2);
ok("card quotes the invalidator", tb[0].message.includes("FY OCF negative"));

console.log("\nopportunity cost vs the REAL alternative (MMF net 8.74%)");
// EY 12, DY 6 filer → 6×0.85 + 6×0.85 = 10.2 after tax → spread +1.46
ok("after-tax equity return", near(equityAfterTaxReturnPct(12, 6, FILER), 10.2, 0.001));
ok("positive spread → no fire", !evaluateTriggers({ ...BASE, earningsYieldPct: 12, dividendYieldPct: 6 }, CFG).some((t) => t.type === "opportunity_cost"));
// EY 8, DY 4 → 6.8 after tax → spread −1.94 → fire
const oc = evaluateTriggers({ ...BASE, earningsYieldPct: 8, dividendYieldPct: 4 }, CFG);
ok("negative spread fires", oc.some((t) => t.type === "opportunity_cost"));
ok("spread math", near(opportunitySpreadPct({ ...BASE, earningsYieldPct: 8, dividendYieldPct: 4 }, CFG), 6.8 - 8.74, 0.001));
ok("no risk-free feed → no fire (never guessed)", !evaluateTriggers({ ...BASE, earningsYieldPct: 8, dividendYieldPct: 4 }, { ...CFG, netRiskFreePct: null }).some((t) => t.type === "opportunity_cost"));

console.log("\nweight — a large position is never a trigger by itself");
ok("60% of the book fires nothing", evaluateTriggers({ ...BASE, weightPct: 60 }, CFG).length === 0);

console.log("\ncyclical peak — low P/E on peak earnings + rising rates = SELL, not bargain");
const CYC: PositionSignal = { ...BASE, classification: "cyclical", peTtm: 4.5, sectorMedianPe: 8, epsLatest: 10, epsMax5y: 10.5, rateDirection: "rising" };
ok("the killer rule fires", cyclicalPeakFires(CYC, CFG));
ok("fires via evaluateTriggers", evaluateTriggers(CYC, CFG).some((t) => t.type === "cyclical_peak"));
ok("not cyclical → off", !cyclicalPeakFires({ ...CYC, classification: "stalwart" }, CFG));
ok("unclassified → off (no guessing the class)", !cyclicalPeakFires({ ...CYC, classification: "" }, CFG));
ok("EPS well below peak → off", !cyclicalPeakFires({ ...CYC, epsLatest: 7 }, CFG));
ok("expensive on screen → off", !cyclicalPeakFires({ ...CYC, peTtm: 9 }, CFG));
ok("rates falling → off", !cyclicalPeakFires({ ...CYC, rateDirection: "falling" }, CFG));
ok("missing sector median → off", !cyclicalPeakFires({ ...CYC, sectorMedianPe: null }, CFG));

console.log("\ncash conversion — the PTL lesson (profit ≠ cash)");
ok("healthy", cashConversion(90, 100)!.grade === "ok");
ok("weak <70%", cashConversion(60, 100)!.grade === "weak");
ok("negative OCF = hard warning", cashConversion(-20, 100)!.grade === "negative");
ok("no OCF entered → null (manual feed, never invented)", cashConversion(null, 100) === null);
ok("weak is warn severity", evaluateTriggers({ ...BASE, cumOcf3y: 60, cumPat3y: 100 }, CFG).find((t) => t.type === "cash_conversion")!.severity === "warn");
ok("negative is action severity", evaluateTriggers({ ...BASE, cumOcf3y: -5, cumPat3y: 100 }, CFG).find((t) => t.type === "cash_conversion")!.severity === "action");

console.log("\ntime stop");
ok("fires past the stop", evaluateTriggers({ ...BASE, monthsHeld: 19, timeStopMonths: 18 }, CFG).some((t) => t.type === "time_stop"));
ok("off when disabled", !evaluateTriggers({ ...BASE, monthsHeld: 99, timeStopMonths: 0 }, CFG).some((t) => t.type === "time_stop"));

console.log("\nGUARD: anchoring to cost");
ok("phrase: wait till it recovers", detectCostAnchoring("wait till it recovers to my buy price", 80) != null);
ok("phrase: break-even", detectCostAnchoring("I'll sell at break-even", 80) != null);
ok("number within 3% of avg cost", detectCostAnchoring("selling half at 81 makes sense", 80) != null);
ok("clean forward reasoning passes", detectCostAnchoring("price is above my fair value high of 53 and the FY26 margin story is gone", 80) === null);
ok("message names the question", detectCostAnchoring("back to my cost", 80)!.includes("TODAY's price"));

console.log("\nGUARD: escalating commitment");
ok("2 raises, 0 reasons → fires", detectEscalation(2, 0) != null);
ok("2 raises, 1 reason → allowed", detectEscalation(2, 1) === null);
ok("3 raises, 1 reason → fires", detectEscalation(3, 1) != null);
ok("message asks the goalposts question", detectEscalation(3, 0)!.includes("goalposts"));

console.log("\nGUARD: thesis drift");
ok("many edits, no decisions → fires", detectThesisDrift(3, 0) != null);
ok("edits with matching decisions → fine", detectThesisDrift(4, 3) === null);

console.log("\ncash as a position");
const today = "2026-07-17";
ok("default_dump shamed", cashFlags({ label: "Brokerage cash", purpose: "default_dump", reviewBy: "", netYieldPct: 0 }, today, 11.07).some((t) => t.message.includes("NO plan")));
ok("expired review = action", cashFlags({ label: "MCB Cash Optimizer", purpose: "strategic_wait", reviewBy: "2026-07-01", netYieldPct: 8.74 }, today, 11.07).find((t) => t.severity === "action") != null);
ok("drag shown", cashFlags({ label: "X", purpose: "default_dump", reviewBy: "", netYieldPct: 8.74 }, today, 11.07)[0].message.includes("2.3pp"));
ok("future review + purpose → quiet", cashFlags({ label: "X", purpose: "strategic_wait", reviewBy: "2026-12-31", netYieldPct: 8.74 }, today, 11.07).length === 0);

console.log("\nre-buy discipline (the PTL 40–53 case)");
const RB = { symbol: "PTL", maxPrice: 53, reviewOn: "2026-10-31", requiredConditions: ["FY26 OCF positive with GM >= 15%", "Note 39 production ≈ sales", "Q1 FY27 GM >= 13%"] };
ok("quiet before reviewOn", rebuyFlags(RB, 45, "2026-07-17").length === 0);
ok("review due fires", rebuyFlags(RB, 45, "2026-11-01").length === 1);
const chase = rebuyFlags(RB, 60, "2026-11-01")[0];
ok("above ceiling says DO NOT CHASE", chase.message.includes("Do not chase"));
ok("mentions the ceiling", chase.message.includes("53.00"));

console.log("\nsuppression — override is allowed, forgetting is not");
const decisions = [
  { symbol: "PTL", action: "hold_through_trigger" as const, firedTriggers: ["price_target"], timestamp: "2026-07-01T00:00:00Z" },
  { symbol: "MEBL", action: "trim" as const, firedTriggers: ["opportunity_cost"], timestamp: "2026-07-10T00:00:00Z" },
];
ok("hold_through suppresses that trigger 90d", triggerSuppressed("price_target", "PTL", decisions, "2026-07-17T00:00:00Z"));
ok("...but not other triggers", !triggerSuppressed("opportunity_cost", "PTL", decisions, "2026-07-17T00:00:00Z"));
ok("...and not forever", !triggerSuppressed("price_target", "PTL", decisions, "2026-10-15T00:00:00Z"));
ok("a recent trim suppresses re-nagging 30d", triggerSuppressed("opportunity_cost", "MEBL", decisions, "2026-07-17T00:00:00Z"));
ok("other symbols unaffected", !triggerSuppressed("price_target", "LUCK", decisions, "2026-07-17T00:00:00Z"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
