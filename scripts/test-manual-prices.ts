// What one press of Update prices does (lib/calculations/manual-prices).
//
//   npx tsx scripts/test-manual-prices.ts

import { manualPlan, MANUAL_GAP_MS } from "../lib/calculations/manual-prices";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const at = (iso: string) => Date.parse(iso) - 5 * 3600_000; // a Karachi time
const none = new Set<string>();
const iqbal = new Set(["2026-11-09"]);

const live = manualPlan({ now: at("2026-11-10T11:42:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-06" });
check("in market hours: the page, once", live.step === "live" && live.day === "2026-11-10", live);
const soon = manualPlan({ now: at("2026-11-10T11:50:00Z"), holidays: none, lastAt: at("2026-11-10T11:42:00Z"), latestFile: "2026-11-06" });
check("pressed again within 15 minutes: nothing read", soon.step === "wait" && soon.nextAt === at("2026-11-10T11:42:00Z") + MANUAL_GAP_MS, soon);
check("after 15 minutes: read again", manualPlan({ now: at("2026-11-10T11:58:00Z"), holidays: none, lastAt: at("2026-11-10T11:42:00Z"), latestFile: "2026-11-06" }).step === "live");
const evening = manualPlan({ now: at("2026-11-10T18:09:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-06" });
check("after the close: the day's closing file, else the page", evening.step === "close-then-live" && evening.day === "2026-11-10", evening);
check("after the close with the file in: nothing to read", manualPlan({ now: at("2026-11-10T19:00:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-10" }).step === "none");
check("Monday to Thursday the market is shut by 15:35", manualPlan({ now: at("2026-11-10T15:40:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-06" }).step === "close-then-live");
check("Friday's second session runs to 16:30", manualPlan({ now: at("2026-11-13T16:00:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-12" }).step === "live");
const early = manualPlan({ now: at("2026-11-11T08:00:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-10" });
check("before the open, yesterday's close in: nothing to read", early.step === "none" && early.day === "2026-11-10", early);
const missing = manualPlan({ now: at("2026-11-11T08:00:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-06" });
check("before the open, yesterday's close missing: fetch it", missing.step === "close" && missing.day === "2026-11-10", missing);
const holiday = manualPlan({ now: at("2026-11-09T12:00:00Z"), holidays: iqbal, lastAt: null, latestFile: "2026-11-06" });
check("on a holiday: the last trading day's close, already in", holiday.step === "none" && holiday.day === "2026-11-06", holiday);
const weekend = manualPlan({ now: at("2026-11-08T12:00:00Z"), holidays: none, lastAt: null, latestFile: "2026-11-05" });
check("at the weekend with Friday's file missing: fetch it", weekend.step === "close" && weekend.day === "2026-11-06", weekend);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
