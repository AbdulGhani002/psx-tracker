// The one daily read of the exchange's site (lib/calculations/sweep): what
// may reach the site, when it starts, and that it takes 8 to 9 hours at
// random.
//
//   npx tsx scripts/test-sweep.ts

import { gateRoute, isWeekday, lastTradingDay, MIN_GAP_MS, nextGap, readLate, readLine, seeded, sweepItems, sweepLength, sweepStart } from "../lib/calculations/sweep";

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

// The morning line and the evening warning.
const none = new Set<string>();
check("Saturday reports Friday's read", lastTradingDay("2026-11-07", none) === "2026-11-06");
check("Monday reports Friday's read too (sent once)", lastTradingDay("2026-11-09", none) === "2026-11-06");
check("a holiday is skipped", lastTradingDay("2026-11-11", new Set(["2026-11-10"])) === "2026-11-09");
const done = { day: "2026-11-06", items: 35, done: 35, read: 35, missed: 0, finishedAt: "2026-11-06T20:26:00Z" };
const ok = readLine({ day: "2026-11-06", read: done, held: 11, closes: 11, lastClose: "2026-11-06", news: [], refusing: false });
check("a good night is one plain line", !ok.warn && ok.text === "📖 <b>Exchange read</b> Fri 6 Nov: 35 of 35 pages, closes for 11 of 11 shares, no new announcements.", ok.text);
const newsy = readLine({ day: "2026-11-06", read: done, held: 11, closes: 11, lastClose: "2026-11-06", news: ["AHCL", "MUREB", "PPL"], refusing: false });
check("new announcements are named", newsy.text.endsWith("new announcements: AHCL, MUREB, PPL."), newsy.text);
const missed = readLine({ day: "2026-11-06", read: { ...done, read: 33, missed: 2 }, held: 11, closes: 11, lastClose: "2026-11-06", news: [], refusing: false });
check("missed pages warn", missed.warn && missed.text.includes("33 of 35 pages, 2 missed"), missed.text);
const noClose = readLine({ day: "2026-11-06", read: done, held: 11, closes: 0, lastClose: "2026-11-05", news: [], refusing: false });
check("no closes warns and says how old the prices are", noClose.warn && noClose.text.includes("no closes for 6 Nov, prices are from 5 Nov"), noClose.text);
const stopped = readLine({ day: "2026-11-06", read: { ...done, done: 12, read: 12, finishedAt: null }, held: 11, closes: 11, lastClose: "2026-11-06", news: [], refusing: true });
check("a read cut short warns", stopped.warn && stopped.text.startsWith("⚠️ <b>Exchange read</b> Fri 6 Nov stopped at 12 of 35 pages, the site is refusing. Closes"), stopped.text);
const notRun = readLine({ day: "2026-11-06", read: { ...done, day: "2026-11-05" }, held: 11, closes: 0, lastClose: "2026-11-05", news: [], refusing: false });
check("a day with no read warns", notRun.warn && notRun.text.startsWith("⚠️ <b>Exchange read</b> Fri 6 Nov did not run. No closes"), notRun.text);
check("no evening warning before 8 pm", readLate({ today: "2026-11-09", hour: 19, holidays: none, readDay: "2026-11-06" }) === null);
check("an evening warning when tonight's read has not started", readLate({ today: "2026-11-09", hour: 20, holidays: none, readDay: "2026-11-06" }) === "⚠️ <b>Exchange read</b> has not started tonight (Mon 9 Nov).");
check("none once it has started, at weekends or on holidays", readLate({ today: "2026-11-09", hour: 21, holidays: none, readDay: "2026-11-09" }) === null && readLate({ today: "2026-11-08", hour: 21, holidays: none, readDay: "2026-11-06" }) === null && readLate({ today: "2026-11-10", hour: 21, holidays: new Set(["2026-11-10"]), readDay: "2026-11-09" }) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
