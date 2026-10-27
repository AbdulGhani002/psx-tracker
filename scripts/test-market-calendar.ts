// The market's dates worked out by rule and caught from headlines, and the
// policy rate's decisions read from the articles
// (lib/calculations/market-calendar, lib/timeseries/sbp-rate).
//
//   npx tsx scripts/test-market-calendar.ts

import { auctionEvents, chartDecisions, eventsMessage, firstWorkingDay, futuresExpiry, mergeEvents, missedMpc, missedMpcMessage, mpcFromHeadline, mpcFromSchedule, nextTradingDay, policyDecisionFrom, policyDecisionHeadline, policyMessage, ruleEvents } from "../lib/calculations/market-calendar";
import { policyRateOn, withNewerSteps } from "../lib/timeseries/sbp-rate";

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

// The policy rate's decisions.
const yes = ["SBP-hikes-policy-rate-by-05", "SBP keeps policy rate unchanged at 11%", "SBP cuts policy rate by 100bps to 10.5%", "MPC maintains policy rate at 11.5pc", "State Bank slashes interest rate by 150bps to 13%"];
check("decision headlines", yes.every(policyDecisionHeadline), yes.filter((h) => !policyDecisionHeadline(h)));
const no = ["Analysts expect SBP to hike policy rate by 50bps", "SBP likely to keep policy rate unchanged: poll", "SBP-raises-Rs880bn-through-MTB-auction", "KSE-100 falls after SBP hikes policy rate", "MPC-How-the-SBPs-language-has-changed-over-21-years", "SBP-sees-forex-reserves-at-25bn-by-June-2027", "Will SBP cut the policy rate?"];
check("not decisions: forecasts, polls, auctions, reactions", !no.some(policyDecisionHeadline), no.filter(policyDecisionHeadline));
const body = "SBP hikes policy rate by 0.5% to 12% MG News | October 26, 2026 at 03:55 PM October 26, 2026 (MLN): The Monetary Policy Committee (MPC) raised the policy rate by 50 basis points to 12% at its meeting on October 26, 2026. The move was in line with market expectations.";
const hike = policyDecisionFrom("SBP hikes policy rate by 0.5% to 12%", body, "2026-10-26T15:55:11Z");
check("a hike: the rate, the meeting, in force the next day", JSON.stringify(hike) === JSON.stringify({ decided: "2026-10-26", from: "2026-10-27", rate: 12, move: "up" }), hike);
const slugOnly = policyDecisionFrom("SBP hikes policy rate by 05", body, null);
check("the rate from the article when the headline lacks it", slugOnly?.rate === 12 && slugOnly.decided === "2026-10-26", slugOnly);
const stated = policyDecisionFrom("SBP cuts policy rate by 100bps to 10.5%", "The MPC decided to cut the policy rate by 100 bps to 10.5 percent, effective from December 17, 2025.", "2025-12-15T16:10:00Z");
check("a stated day of effect; the day published when no meeting is named", stated?.from === "2025-12-17" && stated.decided === "2025-12-15" && stated.move === "down" && stated.rate === 10.5, stated);
const hold = policyDecisionFrom("SBP keeps policy rate unchanged at 11%", "The MPC kept the policy rate at 11% at its meeting held on Monday, 15 September 2025.", "2025-09-15T15:00:00Z");
check("a hold", hold?.move === "same" && hold.rate === 11 && hold.decided === "2025-09-15", hold);
check("no rate, no decision", policyDecisionFrom("SBP hikes policy rate", "The MPC raised the policy rate by 50 basis points.", "2026-10-26T15:55:11Z") === null);
check("the message", policyMessage({ from: "2026-10-27", rate: 12 }, 11.5) === "🏦 <b>Policy rate 12%</b>, up 0.50, from Tue 27 Oct.", policyMessage({ from: "2026-10-27", rate: 12 }, 11.5));

// Mettis's policy-rate chart, dated by the MPC days kept.
const chartRows = [{ Value: 11.5, DateTime: "Apr ,26" }, { Value: 11.5, DateTime: "Jun ,26" }, { Value: 11.5, DateTime: "Jul ,26" }, { Value: 11.5, DateTime: "Sep ,26" }, { Value: 12.0, DateTime: "Oct ,26" }];
const fromChart = chartDecisions(chartRows, ["2026-04-27", "2026-10-26", "2026-12-14"], "2026-10-27");
check("chart: each month with an MPC day kept, in force the next day; the rise marked", JSON.stringify(fromChart) === JSON.stringify([{ decided: "2026-04-27", from: "2026-04-28", rate: 11.5, move: "same" }, { decided: "2026-10-26", from: "2026-10-27", rate: 12, move: "up" }]), fromChart);
check("chart: a meeting still to come is not dated from it", chartDecisions(chartRows, ["2026-10-26"], "2026-10-25").length === 0);
check("chart: rows it cannot read are left out", chartDecisions([{ Value: "x", DateTime: "Oct ,26" }, { Value: 12, DateTime: "October" }], ["2026-10-26"], "2026-10-27").length === 0);
check("missed: an MPC day 2 to 7 days gone with no decision read", missedMpc(["2026-12-14"], [], "2026-12-16") === "2026-12-14" && missedMpc(["2026-12-14"], ["2026-12-14"], "2026-12-16") === null && missedMpc(["2026-12-14"], [], "2026-12-15") === null && missedMpc(["2026-12-14"], [], "2026-12-22") === null);
check("missed: the message", missedMpcMessage("2026-12-14") === "⚠️ <b>MPC of Mon 14 Dec</b>: no decision found in the news. The policy rate may be out of date.", missedMpcMessage("2026-12-14"));

// The kept record and newer word.
const record = [{ from: "2025-05-06", rate: 11 }, { from: "2025-12-16", rate: 10.5 }, { from: "2026-04-28", rate: 11.5 }, { from: "2026-10-27", rate: 12 }];
const old = withNewerSteps(record, [{ from: "2026-07-16", rate: 11.5, src: "live" }, { from: "2026-10-01", rate: 11.5, src: "monthly" }]);
check("older or equal word adds nothing", old.steps.length === 4 && old.steps[0].from === "2026-10-27" && old.src === null, old);
const later = withNewerSteps(record, [{ from: "2026-12-01", rate: 12, src: "monthly" }, { from: "2027-02-01", rate: 11, src: "monthly" }]);
check("a later change is added, newest first", later.steps[0].from === "2027-02-01" && later.steps[0].rate === 11 && later.steps.length === 5 && later.src === "monthly", later.steps.slice(0, 2));
check("in force: the old rate on the day, the new one the day after", policyRateOn("2026-10-26", record) === 11.5 && policyRateOn("2026-10-27", record) === 12 && policyRateOn("2026-04-24", record) === 10.5);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
