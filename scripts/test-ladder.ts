import {
  planLadder,
  ladderVerdict,
  reachShare,
  fallAtShare,
  fallDistributionOf,
  suggestLadder,
  reweightLadder,
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


// ------------------------------------------ can these rungs actually be paid for
{
  const dist = fallDistributionOf(Array.from({ length: 400 }, (_, i) => ({ close: 100000 - (i % 30) * 400 })));
  // No reserve here, so a rung's slice is a round share of the pool and the
  // funding arithmetic is readable by eye.
  const base = {
    indexLevel: 99000,
    poolAtArming: 1000000,
    reservePct: 0,
    referenceHigh: 100000,
    fallDistribution: dist,
  };
  // Three rungs of 300,000 each against 350,000 in hand plus a dated invoice.
  // The first is paid by cash, the second finishes on the invoice, the third has
  // nothing behind it.
  const plan = planLadder({
    ...base,
    rungs: [rung(98000, 30, "a"), rung(96000, 30, "b"), rung(94000, 30, "c")],
    poolNow: 350000,
    fundingSources: [
      { label: "Client invoice", pkr: 250000, expectedDate: "2026-09-14" },
      { label: "Loan back", pkr: 24000, expectedDate: "2026-10-01" },
    ],
  });
  const [a, b, c] = plan.rows;

  check("cash in hand covers the first rung", a.funding === "now", { funding: a.funding, by: a.fundedBy });
  check("the second rung waits on the invoice", b.funding === "dated", { funding: b.funding, on: b.fundedOn });
  check("and it names which one, and when", b.fundedBy === "Client invoice" && b.fundedOn === "2026-09-14", {
    by: b.fundedBy,
    on: b.fundedOn,
  });
  check("the third rung has nothing behind it", c.funding === "short", { funding: c.funding, short: Math.round(c.shortfall) });
  // 900,000 promised, 350,000 cash, 274,000 dated: 276,000 of the last rung
  // has nothing behind it.
  check("the shortfall is the real gap", Math.abs(c.shortfall - 276000) < 2, Math.round(c.shortfall));
  check(
    "the three buckets add up to what was promised",
    Math.abs(plan.fundedNow + plan.fundedLater + plan.unfunded - plan.committed) < 1,
    { now: Math.round(plan.fundedNow), later: Math.round(plan.fundedLater), un: Math.round(plan.unfunded) }
  );
  check("every rupee of cash is put to work before a date is quoted", Math.abs(plan.fundedNow - 350000) < 1, Math.round(plan.fundedNow));
  check("the summary says money is missing", plan.fundingLine.includes("nothing behind it"), plan.fundingLine.slice(0, 60));

  // The reserve is not spendable, so it never funds a rung.
  const withReserve = planLadder({
    ...base,
    reservePct: 10,
    rungs: [rung(98000, 100, "all")],
    poolNow: 350000,
    fundingSources: [],
  });
  check(
    "the reserve is held back from funding too",
    Math.abs(withReserve.fundedNow - 250000) < 1,
    Math.round(withReserve.fundedNow)
  );

  // Everything in hand: no dates, no warnings.
  const rich = planLadder({
    ...base,
    rungs: [rung(98000, 30), rung(96000, 30)],
    poolNow: 1000000,
    fundingSources: [],
  });
  check("a fully funded ladder says so", rich.rows.every((r) => r.funding === "now"), rich.rows.map((r) => r.funding));
  check("and nothing is unfunded", rich.unfunded === 0, rich.unfunded);
  check("its summary is the calm one", rich.fundingLine.includes("Every rung is covered"), rich.fundingLine.slice(0, 40));

  // Earlier rungs eat the cash first: a rung is funded in the order it fires.
  const order = planLadder({
    ...base,
    rungs: [rung(98000, 50), rung(96000, 50)],
    poolNow: 500000, // exactly one rung's worth
    fundingSources: [],
  });
  check("the first rung is funded before the second", order.rows[0].funding === "now", order.rows[0].funding);
  check("the second is left short", order.rows[1].funding === "short", order.rows[1].funding);

  // A fired rung was paid for at the time and makes no claim on today's money.
  const fired = planLadder({
    ...base,
    rungs: [rung(98000, 50, "done", "2026-08-01", 400000), rung(96000, 50)],
    poolNow: 500000,
    fundingSources: [],
  });
  check("a fired rung does not compete for cash", fired.rows[0].fundedBy === "already fired", fired.rows[0].fundedBy);
  check("so the next rung is funded", fired.rows[1].funding === "now", fired.rows[1].funding);
  check("and only unfired rungs are committed", Math.abs(fired.committed - 500000) < 1, Math.round(fired.committed));

  // No funding information at all: say nothing rather than guess.
  const blind = planLadder({ ...base, rungs: [rung(98000, 50)], poolNow: 0 });
  check("no cash and no sources means short, not silent", blind.rows[0].funding === "short", blind.rows[0].funding);
}

// ------------------------------------------ keep the levels, fix the weights
{
  const closes: number[] = [];
  for (let i = 0; i < 900; i++) closes.push(100000 - (i % 30) * 300);
  for (let i = 0; i < 100; i++) closes.push(100000 * (1 - 0.3 * (i / 99)));
  const dist = fallDistributionOf(closes.map((close) => ({ close })));

  const mine = [
    { level: 96000, pct: 15, label: "Immediate support" },
    { level: 82000, pct: 25, label: "Important Level" },
    { level: 75000, pct: 30, label: "Floor" },
  ];
  const out = reweightLadder(mine, dist, 100000);

  check("every level is kept", out.map((r) => r.level).join(",") === "96000,82000,75000", out.map((r) => r.level));
  check("the weights add to exactly 100", out.reduce((a, r) => a + r.pct, 0) === 100, out.map((r) => r.pct));
  check("the old weight is reported alongside", out.every((r) => r.wasPct > 0), out.map((r) => r.wasPct));
  check("labels survive", out[1].label === "Important Level", out[1].label);
  check("the reachable level gains", out[0].pct > out[0].wasPct, { was: out[0].wasPct, now: out[0].pct });
  check("the rare level loses", out[2].pct < out[2].wasPct, { was: out[2].wasPct, now: out[2].pct });
  check("but a level you believe in keeps a stake", out[2].pct >= 5, out[2].pct);
  check("nothing is left at zero", out.every((r) => r.pct > 0), out.map((r) => r.pct));

  // A reweighted ladder must not itself be dead weight.
  const after = planLadder({
    indexLevel: 95000,
    rungs: out.map((r) => rung(r.level, r.pct, r.label)),
    poolAtArming: 1000000,
    poolNow: 1000000,
    reservePct: 10,
    referenceHigh: 100000,
    fallDistribution: dist,
  });
  check("reweighting clears the dead-weight flag", after.deadPct === 0, after.deadPct);

  // The case that bit on real data: a level just under the rarity line coming
  // out just over the "holds real money" line, so the fix left its own warning
  // standing. The reweight must trim it below that line by construction.
  {
    const borderline = [
      { level: 96500, pct: 15, label: "shallow" },
      { level: 84000, pct: 25, label: "just too rare" },
      { level: 70000, pct: 30, label: "never" },
    ];
    const out2 = reweightLadder(borderline, dist, 100000);
    const check2 = planLadder({
      indexLevel: 95000,
      rungs: out2.map((r) => rung(r.level, r.pct, r.label)),
      poolAtArming: 1000000,
      poolNow: 1000000,
      reservePct: 10,
      referenceHigh: 100000,
      fallDistribution: dist,
    });
    check("a borderline rung is trimmed under the flag", check2.deadPct === 0, {
      pcts: out2.map((r) => r.pct),
      dead: check2.deadPct,
    });
    check("and the weights still add to 100", out2.reduce((a, r) => a + r.pct, 0) === 100, out2.map((r) => r.pct));
    check("the trimmed weight goes to the rung that fires", out2[0].pct > out2[1].pct, out2.map((r) => r.pct));
  }

  check("no levels means no reweight", reweightLadder([], dist, 100000).length === 0);
  check("no history means no reweight", reweightLadder(mine, [], 100000).length === 0);
  check("no reference high means no reweight", reweightLadder(mine, dist, 0).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
