// The one daily read of the exchange's site (lib/calculations/sweep): what
// may reach the site, when it starts, and that it takes 8 to 9 hours at
// random.
//
//   npx tsx scripts/test-sweep.ts

import { gateRoute, isWeekday, MIN_GAP_MS, nextGap, seeded, sweepItems, sweepLength, sweepStart } from "../lib/calculations/sweep";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const HOUR = 3600_000;

check("the sweep reads pages from the site", gateRoute("/company/MEBL", "GET", true) === "site" && gateRoute("/indices/KSE100", "GET", true) === "site");
check("everything else gets the copy kept", ["/company/MEBL", "/indices", "/indices/KSE100"].every((p) => gateRoute(p, "GET", false) === "kept"));
check("the closing file and a company's documents go when wanted", gateRoute("/download/mkt_summary/2026-11-03.Z", "GET", false) === "site" && gateRoute("/download/document/x.pdf", "GET", false) === "site");
check("a POST goes, closed addresses being asked once a week", gateRoute("/payouts", "POST", false) === "site");
check("addresses the site has dropped go nowhere", gateRoute("/market-watch", "GET", false) === "none" && gateRoute("/timeseries/eod/MEBL", "GET", false) === "none");

const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
const pk = (t: number) => new Date(t + 5 * HOUR).toISOString().slice(11, 16);
const starts = days.map(sweepStart);
check("it starts between 17:00 and 18:30 in Karachi", starts.every((t) => pk(t) >= "17:00" && pk(t) < "18:30"), starts.map(pk));
check("a different time each day", new Set(starts.map(pk)).size >= 7);
check("the same time on every tick of a day", sweepStart("2026-11-04") === sweepStart("2026-11-04"));
check("no sweep at the weekend", !isWeekday("2026-11-07") && !isWeekday("2026-11-08") && isWeekday("2026-11-09"));

function walk(seed: string, n: number): { hours: number; gaps: number[] } {
  const rnd = seeded(seed);
  const start = Date.parse("2026-11-04T13:00:00Z");
  const finishBy = start + sweepLength(rnd);
  let t = start;
  const gaps: number[] = [];
  for (let left = n - 1; left > 0; left--) {
    const g = nextGap(t, finishBy, left, rnd);
    gaps.push(g);
    t += g;
  }
  return { hours: (t - start) / HOUR, gaps };
}
const runs = [25, 30, 40].flatMap((n) => ["a", "b", "c", "d", "e", "f"].map((s) => walk(`${s}${n}`, n)));
check("the day's reading takes about 8 to 9 hours", runs.every((r) => r.hours >= 7 && r.hours <= 9.5), runs.map((r) => r.hours.toFixed(1)).join(" "));
check("never two pages under four minutes apart", runs.every((r) => r.gaps.every((g) => g >= MIN_GAP_MS)));
const one = runs[0].gaps;
check("the gaps differ at random", new Set(one.map((g) => Math.round(g / 60000))).size >= one.length / 2, one.map((g) => Math.round(g / 60000)).join(" "));
check("behind time, it hurries no faster than four minutes", nextGap(100, 50, 10, () => 0.5) === MIN_GAP_MS);

const list = sweepItems({ indices: ["/indices", "/indices/KSE100"], held: ["MEBL", "AHCL"], rest: ["BOP", "NBP"], wished: ["/company/ATIL", "/company/BOP"] }, seeded("x"));
check("the index pages first, then the shares held", list.slice(0, 2).every((p) => p.startsWith("/indices")) && list.slice(2, 4).sort().join() === "/company/AHCL,/company/MEBL", list);
check("no page twice", new Set(list).size === list.length && list.length === 7, list.length);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
