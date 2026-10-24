// The market's dates worked out by rule and caught from headlines
// (lib/calculations/market-calendar).
//
//   npx tsx scripts/test-market-calendar.ts

import { auctionEvents, eventsMessage, firstWorkingDay, futuresExpiry, mergeEvents, mpcFromHeadline, mpcFromSchedule, nextTradingDay, ruleEvents } from "../lib/calculations/market-calendar";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const holidays = new Set(["2026-11-09", "2026-12-25", "2027-05-28", "2027-02-05"]);
// As the guide's calendar has them.
check("futures expire on the month's last Friday", futuresExpiry(2026, 10, holidays) === "2026-10-30" && futuresExpiry(2026, 11, holidays) === "2026-11-27" && futuresExpiry(2027, 1, holidays) === "2027-01-29");
check("a Friday holiday moves it to Thursday", futuresExpiry(2026, 12, holidays) === "2026-12-24" && futuresExpiry(2027, 5, holidays) === "2027-05-27");
check("CPI on the first working day", firstWorkingDay(2026, 11, holidays) === "2026-11-02" && firstWorkingDay(2027, 2, holidays) === "2027-02-01" && firstWorkingDay(2026, 8, new Set(["2026-08-14"])) === "2026-08-03");

const ev = ruleEvents("2026-10-24", "2027-04-30", holidays);
const on = (d: string) => ev.filter((e) => e.date === d).map((e) => e.title);
check("results deadlines: quarters to September and the June-year annual", on("2026-10-30").includes("Results due: quarters to September") && on("2026-10-30").includes("PSX futures expiry"));
check("the half-year to December by 1 March", on("2027-03-01").includes("Results due: half-year to December (June-year companies)"));
check("index reviews: KMI-30 in November, KSE-100 in March and April", on("2026-11-15").includes("KMI-30 review") && on("2027-03-15").includes("KSE-100 notice and KSE-30 changes") && on("2027-04-01").includes("KSE-100 recomposition takes effect"));
check("December's CPI named for November", on("2026-12-01").includes("CPI for November"));
check("nothing before the window", !ev.some((e) => e.date < "2026-10-24"));

const auc = auctionEvents("2026-10-14", "2026-10-24", "2026-11-30");
check("auctions a fortnight apart from the last one kept", auc.map((a) => a.date).join() === "2026-10-28,2026-11-11,2026-11-25");

check("headline: SBP to announce monetary policy on May 20", mpcFromHeadline("the-state-bank-of-pakistan-to-announce-monetary-policy-on-may-20", "2027-05-10") === "2027-05-20");
check("headline: monetary policy to be announced on Friday 29th September", mpcFromHeadline("monetary-policy-to-be-announced-on-friday-29th-september", "2027-09-20") === "2027-09-29");
check("headline: MPC meeting on Monday, October 26", mpcFromHeadline("MPC meeting on Monday, October 26", "2026-10-20") === "2026-10-26");
check("not a date to come: a decision already taken", mpcFromHeadline("monetary-policy-committee-has-decided-to-keep-the-policy-rate-unchanged-on-october-26", "2026-10-26") === null);
check("not about the MPC", mpcFromHeadline("SBP-revises-investment-limits-for-banks-on-october-20", "2026-10-15") === null);
check("too far off to be this meeting", mpcFromHeadline("SBP to announce monetary policy on March 10", "2026-10-24") === null);

const sched = mpcFromSchedule("The MPC will meet on 26 October 2026, 14 December 2026, 25 January 2027, 8 March 2027, 26 April 2027 and 17 June 2027. Published 30 June 2026.", "2026-10-01");
check("a schedule: every date ahead", sched.join() === "2026-10-26,2026-12-14,2027-01-25,2027-03-08,2027-04-26,2027-06-17", sched);
check("two dates are no schedule", mpcFromSchedule("Results on 30 October 2026 and 1 March 2027.", "2026-10-01").length === 0);

const merged = mergeEvents([{ date: "2026-12-24", title: "PSX futures expiry (Thursday)", kind: "expiry", about: false, source: "PSX" }], ruleEvents("2026-12-01", "2026-12-31", holidays));
check("an announced date covers the rule's on the same day", merged.filter((e) => e.kind === "expiry").length === 1 && merged.some((e) => e.title === "PSX futures expiry (Thursday)"));

check("the next trading day skips the weekend", nextTradingDay("2026-10-23", holidays) === "2026-10-26" && nextTradingDay("2026-11-06", holidays) === "2026-11-10");
const all = mergeEvents([{ date: "2026-10-26", title: "MPC decision", kind: "mpc", about: false, source: "Mettis" }], ruleEvents("2026-10-24", "2026-11-30", holidays));
const fri = eventsMessage(all, "2026-10-23", holidays);
check("Friday evening: Monday's dates", fri === "📅 <b>Coming up</b>\nMonday 26 Oct: MPC decision", fri);
check("the evening before: tomorrow", eventsMessage(all, "2026-10-29", holidays) === "📅 <b>Coming up</b>\nTomorrow: PSX futures expiry · Results due: quarters to September");
check("nothing due: no message", eventsMessage(all, "2026-10-26", holidays) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
