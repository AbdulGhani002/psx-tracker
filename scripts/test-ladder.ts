import { planLadder, ladderVerdict, type LadderRung } from "../lib/calculations/ladder";
import { valueFund } from "../lib/calculations/assets";

let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log("PASS ", name, got ?? "");
  } else {
    fail++;
    console.log("FAIL ", name, got ?? "");
  }
}

const rung = (level: number, pct: number, label = "", firedAt = "", firedAmount = 0): LadderRung => ({
  level,
  pct,
  label,
  firedAt,
  firedAmount,
});

// ---------------------------------------------------------------- the ladder
const rungs = [rung(168000, 20, "first support"), rung(162000, 25), rung(156000, 25), rung(148000, 20)];

// Index above every rung: nothing arms, the nearest one is the highest.
const above = planLadder({ indexLevel: 175500, rungs, poolAtArming: 500000, poolNow: 500000, reservePct: 10 });
check("nothing ready when index is above every rung", above.ready.length === 0, above.ready.length);
check("next rung is the highest one below", above.next?.level === 168000, above.next?.level);
check("reserve carved out of the pool", above.reserveAmount === 50000, above.reserveAmount);
check("ladder pool is pool less reserve", above.ladderPool === 450000, above.ladderPool);
check("first rung sized off the ladder pool", Math.round(above.rows[0].amount) === 90000, above.rows[0].amount);
check("next rung needs a 4.3% fall", Math.abs(above.next!.moveRequiredPct + 4.27) < 0.02, above.next!.moveRequiredPct.toFixed(2) + "%");
check("verdict says wait", ladderVerdict(above).action === "WAIT", ladderVerdict(above).line);

// Index through two rungs: both arm, and the money is the sum of the two.
const through = planLadder({ indexLevel: 160000, rungs, poolAtArming: 500000, poolNow: 500000, reservePct: 10 });
check("two rungs ready when index falls through both", through.ready.length === 2, through.ready.map((r) => r.level));
check("ready amount is the sum of both slices", Math.round(through.readyAmount) === 202500, through.readyAmount);
check("verdict says deploy", ladderVerdict(through).action === "DEPLOY", ladderVerdict(through).line);
check("next is the first rung still below", through.next?.level === 156000, through.next?.level);

// A fired rung never arms again, however the index moves.
const fired = planLadder({
  indexLevel: 160000,
  rungs: [rung(168000, 20, "", "2026-08-01", 90000), rung(162000, 25)],
  poolAtArming: 500000,
  poolNow: 410000,
  reservePct: 10,
});
check("a fired rung stays fired", fired.rows[0].status === "FIRED", fired.rows[0].status);
check("only the unfired rung is ready", fired.ready.length === 1 && fired.ready[0].level === 162000, fired.ready[0]?.level);
check("fired amount reported", fired.firedAmount === 90000, fired.firedAmount);

// Slices are cut from the pool AT ARMING, not from what is left. This is the
// property that stops the ladder shrinking itself as you spend.
check("slice does not shrink after a spend", Math.round(fired.rows[1].amount) === 112500, fired.rows[1].amount);

// The ladder will not instruct a spend larger than the money above the reserve.
const thin = planLadder({
  indexLevel: 150000,
  rungs,
  poolAtArming: 500000,
  poolNow: 120000, // most of it already spent
  reservePct: 10,
});
check("ready amount is capped by cash actually left", Math.round(thin.readyAmount) === 70000, thin.readyAmount);
check("it warns when the rules outrun the cash", thin.warnings.some((w) => w.includes("reserve")), thin.warnings[0]);

// Over-allocation is caught rather than silently funded.
const over = planLadder({
  indexLevel: 175000,
  rungs: [rung(170000, 60), rung(160000, 60)],
  poolAtArming: 100000,
  poolNow: 100000,
});
check("over-allocated rungs warn", over.warnings.some((w) => w.includes("120%")), over.warnings[0]);

// No rungs at all is a state the app must name, not hide.
const none = planLadder({ indexLevel: 175000, rungs: [], poolAtArming: 100000, poolNow: 100000 });
check("empty ladder is called out", ladderVerdict(none).action === "SET_UP", ladderVerdict(none).line);

// Ordering: rungs come back highest-level first whatever order they went in.
const jumbled = planLadder({
  indexLevel: 200000,
  rungs: [rung(150000, 25), rung(170000, 25), rung(160000, 25)],
  poolAtArming: 100000,
  poolNow: 100000,
});
check(
  "rungs ordered by trigger sequence",
  jumbled.rows.map((r) => r.level).join(",") === "170000,160000,150000",
  jumbled.rows.map((r) => r.level).join(",")
);
check("cumulative pct accumulates in order", jumbled.rows[2].cumulativePct === 75, jumbled.rows[2].cumulativePct);

// ------------------------------------------------- money-market daily accrual
// Weekday: NAV is today's, so nothing is added on top.
const weekday = valueFund(
  { units: 978.0209, avgCost: 103.476356, moneyMarket: true, annualYieldPct: 10.25 },
  104.4116,
  "2026-08-31",
  "2026-08-31"
);
check("no accrual when the NAV is today's", weekday.accruedDays === 0, weekday.accruedDays);
check("weekday value is units x published NAV", Math.round(weekday.value) === 102117, Math.round(weekday.value));
check("a day's earnings is still shown", weekday.earnedPerDay > 25 && weekday.earnedPerDay < 30, weekday.earnedPerDay.toFixed(2));

// Sunday: NAV is Friday's, two days are carried forward so the balance moves.
const sunday = valueFund(
  { units: 978.0209, avgCost: 103.476356, moneyMarket: true, annualYieldPct: 10.25 },
  104.4116,
  "2026-09-02",
  "2026-08-31"
);
check("weekend carries the NAV forward", sunday.accruedDays === 2, sunday.accruedDays);
check("weekend value is higher than Friday's", sunday.value > weekday.value, (sunday.value - weekday.value).toFixed(2));
check("two days of carry is about two days of yield", Math.abs(sunday.value - weekday.value - 2 * weekday.earnedPerDay) < 1, (sunday.value - weekday.value).toFixed(2));
check("earned since anchor is the carry", Math.abs(sunday.earnedSinceAnchor - (sunday.value - weekday.value)) < 0.01, sunday.earnedSinceAnchor.toFixed(2));

// A plain growth fund must NOT be given an invented trend.
const equityFund = valueFund({ units: 100, avgCost: 100, annualYieldPct: 20 }, 112.25, "2026-09-02", "2026-08-31");
check("non money-market growth fund is not accrued", equityFund.accruedDays === 0, equityFund.accruedDays);
check("growth fund value stays units x NAV", equityFund.value === 11225, equityFund.value);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
