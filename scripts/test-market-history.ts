// The KSE-100 month by month (lib/calculations/market-history): month-ends,
// the rebuilt index, the splice with the exchange's own months, the calendar
// months, the rate cycles and what followed each turn.
//
//   npx tsx scripts/test-market-history.ts

import { afterTurns, cycleStats, indexMonthly, monthEnds, monthPatterns, rebuildMonthly, splice, stateOf, turnsFromSteps, type MonthRet } from "../lib/calculations/market-history";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null | undefined, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

const ends = monthEnds([{ date: "2026-01-30", close: 100 }, { date: "2026-01-15", close: 90 }, { date: "2026-02-27", close: 110 }, { date: "2026-03-31", close: 99 }]);
check("a month's end is its last close", ends.get("2026-01") === 100 && ends.size === 3);
const im = indexMonthly(ends);
check("monthly returns from month-ends", near(im.get("2026-02"), 10) && near(im.get("2026-03"), -10) && !im.has("2026-01"));

// Two members: A twice B's value at January's end; A +10% and a 2% dividend,
// B −5%. A third with no February close is left out of February.
const members = [
  { units: 2, ends: new Map([["2026-01", 100], ["2026-02", 110]]), divPct: new Map([["2026-02", 2]]) },
  { units: 1, ends: new Map([["2026-01", 200], ["2026-02", 190]]), divPct: new Map<string, number>() },
  { units: 5, ends: new Map([["2026-01", 50]]), divPct: new Map<string, number>() },
];
const rb = rebuildMonthly(members, ["2026-02"], 2);
check("weighted by value at the month before's end, dividends added back", near(rb.get("2026-02"), ((200 * 0.12 + 200 * -0.05) / 400) * 100), rb.get("2026-02"));
check("too few members priced: no month", rebuildMonthly(members, ["2026-02"], 3).size === 0);

const real = new Map([["2026-02", 3.5], ["2026-03", -1]]);
const rebuilt = new Map([["2026-01", 2], ["2026-02", 3.4], ["2026-03", -1.2]]);
const sp = splice(real, rebuilt);
check("the exchange's months where it has them, rebuilt before", sp.series.map((r) => `${r.month}:${r.source}`).join() === "2026-01:rebuilt,2026-02:index,2026-03:index");
check("the fit on the months both have", sp.fit.months === 2 && near(sp.fit.meanAbsDiff, 0.15, 1e-9));

// Two years of months: Januaries up both years, Mays down both.
const series: MonthRet[] = [];
for (const y of [2024, 2025]) for (let m = 1; m <= 12; m++) series.push({ month: `${y}-${String(m).padStart(2, "0")}`, ret: m === 1 ? 4 + (y - 2024) : m === 5 ? -3 : 1, source: "index" });
const pat = monthPatterns(series);
const jan = pat.months.find((x) => x.m === 1)!, may = pat.months.find((x) => x.m === 5)!;
check("each calendar month: years, years up, average, median", jan.n === 2 && jan.up === 2 && near(jan.mean, 4.5) && near(jan.median, 4.5) && may.up === 0 && near(may.mean, -3));
check("its best and worst", jan.best.month === "2025-01" && jan.worst.month === "2024-01");
check("the span and the average month", pat.from === "2024-01" && pat.to === "2025-12" && pat.n === 24);

// SBP steps: rises to 22, cuts to 11, a rise to 11.5.
const steps = [
  { from: "2021-09-21", rate: 7.25 }, { from: "2021-08-01", rate: 7 }, { from: "2022-04-08", rate: 12.25 }, { from: "2023-06-27", rate: 22 },
  { from: "2024-06-11", rate: 20.5 }, { from: "2025-05-06", rate: 11 }, { from: "2026-04-28", rate: 11.5 },
];
const turns = turnsFromSteps(steps);
check("a cycle begins with the first change the other way", turns.map((t) => `${t.date}:${t.kind}`).join() === "2021-09-21:rise,2024-06-11:cut,2026-04-28:rise", turns);
check("with the rate before and after", turns[1].before === 22 && turns[1].after === 20.5);
check("a month's state: the last change made before it began", stateOf("2024-06", turns) === "tightening" && stateOf("2024-07", turns) === "easing" && stateOf("2021-09", turns) === null);

const cyc = cycleStats(series, turns);
check("easing and tightening months counted and averaged", cyc.easing.n === 18 && cyc.tightening.n === 6, cyc);

const after = afterTurns(series, [{ date: "2024-06-11", kind: "cut", before: 22, after: 20.5 }, { date: "2025-11-15", kind: "rise", before: 11, after: 11.5 }]);
check("three months after a turn, from the month-end before it", near(after[0].m3, (1.01 ** 3 - 1) * 100, 1e-9) && after[0].soFar === null);
check("twelve months after, when there are twelve", after[0].m12 != null && after[1].m12 === null);
check("the turn under way: so far", near(after[1].soFar, (1.01 ** 2 - 1) * 100, 1e-9), after[1]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
