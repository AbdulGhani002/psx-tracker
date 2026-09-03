import {
  planLadder,
  ladderVerdict,
  reachShare,
  fallAtShare,
  fallDistributionOf,
  suggestLadder,
  type LadderRung,
} from "../lib/calculations/ladder";
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


// ------------------------------------- reachability: is a rung a plan or a wish
{
  // A market that spends most of its life near the high and dips hard once.
  const closes: number[] = [];
  for (let i = 0; i < 900; i++) closes.push(100000 - (i % 30) * 300); // shallow chop
  for (let i = 0; i < 20; i++) closes.push(100000 * (1 - 0.3 * (i / 19))); // one crash
  for (let i = 0; i < 80; i++) closes.push(70000 + 30000 * (i / 79));
  const dist = fallDistributionOf(closes.map((close) => ({ close })));

  check("distribution starts at 100% of sessions", Math.abs(dist[0].sharePct - 100) < 0.01, dist[0].sharePct);
  check(
    "distribution never rises as the fall deepens",
    dist.every((d, i) => i === 0 || d.sharePct <= dist[i - 1].sharePct)
  );
  const deep = dist.find((d) => d.fallPct === 25)!;
  check("a once-off crash is a tiny share of sessions", deep.sharePct < 3, deep.sharePct.toFixed(2));

  check("reachShare falls as the level deepens", (reachShare(dist, 5) ?? 0) > (reachShare(dist, 7) ?? 0));
  check("reachShare past the deepest bucket is zero", reachShare(dist, 90) === 0, reachShare(dist, 90));
  check("reachShare with no history is null", reachShare([], 5) === null);
  check(
    "fallAtShare inverts reachShare",
    Math.abs((reachShare(dist, fallAtShare(dist, 20) ?? 0) ?? 0) - 20) < 2,
    fallAtShare(dist, 20)?.toFixed(1)
  );

  // The shape this whole diagnostic exists to catch: most of the pool parked at
  // a level that essentially never arrives.
  const plan = planLadder({
    indexLevel: 95000,
    rungs: [rung(96000, 20, "shallow"), rung(72000, 50, "the big one")],
    poolAtArming: 1000000,
    poolNow: 1000000,
    reservePct: 10,
    referenceHigh: 100000,
    fallDistribution: dist,
  });
  const shallow = plan.rows.find((r) => r.level === 96000)!;
  const deepRung = plan.rows.find((r) => r.level === 72000)!;
  check("a rung's depth is measured from the high", Math.abs((shallow.fallFromHighPct ?? 0) - 4) < 0.01, shallow.fallFromHighPct);
  check("the shallow rung is reachable", (shallow.reachedSharePct ?? 0) > 20, shallow.reachedSharePct?.toFixed(1));
  check("the deep rung is flagged dead", deepRung.reach === "dead", {
    share: deepRung.reachedSharePct?.toFixed(2),
    reach: deepRung.reach,
  });
  check("dead weight is counted", plan.deadPct === 50, plan.deadPct);
  check(
    "the diagnostic names the level and the money",
    plan.diagnostics.some((d) => d.includes("72,000") && d.includes("50%")),
    plan.diagnostics.length
  );
  check(
    "a coreless ladder is told it is a gate",
    plan.diagnostics.some((d) => d.includes("standing bet against the drift"))
  );

  // A token rung on a rare level is not worth nagging about.
  const tiny = planLadder({
    indexLevel: 95000,
    rungs: [rung(96000, 90), rung(72000, 5)],
    poolAtArming: 1000000,
    poolNow: 1000000,
    referenceHigh: 100000,
    fallDistribution: dist,
  });
  check("a small rung on a rare level is left alone", tiny.rows.find((r) => r.level === 72000)!.reach === "", tiny.deadPct);

  // Without history the ladder behaves exactly as it always did.
  const blind = planLadder({ indexLevel: 95000, rungs: [rung(72000, 50)], poolAtArming: 1000, poolNow: 1000 });
  check("no history means no verdict", blind.rows[0].reach === "" && blind.rows[0].reachedSharePct === null);
  check("no history means no diagnostics", blind.diagnostics.length === 0, blind.diagnostics);
}

// ------------------------------------------------------------------- the core
{
  const dist = fallDistributionOf(Array.from({ length: 500 }, (_, i) => ({ close: 100000 - (i % 25) * 200 })));
  const withCore = planLadder({
    indexLevel: 99000,
    rungs: [rung(98000, 50), rung(96000, 50)],
    poolAtArming: 1000000,
    poolNow: 1000000,
    reservePct: 10,
    corePct: 40,
    referenceHigh: 100000,
    fallDistribution: dist,
  });
  check("the core is taken after the reserve", Math.abs(withCore.coreAmount - 360000) < 1, withCore.coreAmount);
  check("the rungs divide only what is left", Math.abs(withCore.ladderPool - 540000) < 1, withCore.ladderPool);
  check("the reserve is untouched by the core", withCore.reserveAmount === 100000, withCore.reserveAmount);
  check(
    "core plus rungs plus reserve is the whole pool",
    Math.abs(withCore.coreAmount + withCore.ladderPool + withCore.reserveAmount - 1000000) < 1
  );

  const noCore = planLadder({
    indexLevel: 99000,
    rungs: [rung(98000, 50), rung(96000, 50)],
    poolAtArming: 1000000,
    poolNow: 1000000,
    reservePct: 10,
  });
  check("no core leaves the old arithmetic exactly as it was", noCore.ladderPool === 900000 && noCore.coreAmount === 0, noCore.ladderPool);
}

// --------------------------------------------------------- the suggested shape
{
  const closes: number[] = [];
  for (let i = 0; i < 800; i++) closes.push(100000 - (i % 40) * 250);
  for (let i = 0; i < 200; i++) closes.push(100000 * (1 - 0.2 * (i / 199)));
  const dist = fallDistributionOf(closes.map((close) => ({ close })));
  const s4 = suggestLadder(dist, 100000, 4);

  check("four rungs are proposed", s4.length === 4, s4.length);
  check("the weights add to exactly 100", s4.reduce((a, r) => a + r.pct, 0) === 100, s4.map((r) => r.pct));
  check("levels descend", s4.every((r, i) => i === 0 || r.level < s4[i - 1].level), s4.map((r) => r.level));
  check("weight falls as depth grows", s4.every((r, i) => i === 0 || r.pct <= s4[i - 1].pct), s4.map((r) => r.pct));
  check("the most reachable rung carries the most money", s4[0].pct > s4[s4.length - 1].pct * 3, {
    first: s4[0].pct,
    last: s4[s4.length - 1].pct,
  });
  check("levels are round enough to write down", s4.every((r) => r.level % 500 === 0), s4.map((r) => r.level));

  // The point of the whole exercise: what it proposes must not itself be dead.
  const proposed = planLadder({
    indexLevel: 95000,
    rungs: s4.map((r) => rung(r.level, r.pct, r.label)),
    poolAtArming: 1000000,
    poolNow: 1000000,
    reservePct: 10,
    referenceHigh: 100000,
    fallDistribution: dist,
  });
  check("the suggested ladder has no dead rungs", proposed.deadPct === 0, proposed.deadPct);

  check("two rungs can be asked for", suggestLadder(dist, 100000, 2).length === 2);
  check("no history means no suggestion", suggestLadder([], 100000, 4).length === 0);
  check("no reference high means no suggestion", suggestLadder(dist, 0, 4).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
