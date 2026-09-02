// Backtest engine checks, on made-up series with known answers.
//
// Real market data cannot tell you whether the engine is right, only what the
// market did. These series have one obvious correct answer each, so a bug shows
// up as a wrong number rather than a plausible one.

import { runBacktest, regimeFloorFromIndex, type Bar, type BacktestConfig } from "../lib/calculations/backtest";

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

// Weekdays only, so the calendar gaps look like a real market.
function weekdays(startIso: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(startIso + "T00:00:00Z");
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const series = (startIso: string, closes: number[]): Bar[] =>
  weekdays(startIso, closes.length).map((date, i) => ({ date, close: closes[i] }));

const N = 1300; // about five years of weekdays

const CFG: Partial<BacktestConfig> = {
  startCash: 100000,
  monthlyContribution: 25000,
  cashYieldPct: 11,
  reservePct: 10,
  rearmWithinPct: 2,
  costPct: 0,
  rungs: [
    { fallPct: 5, pct: 30, label: "first" },
    { fallPct: 10, pct: 30, label: "second" },
    { fallPct: 20, pct: 40, label: "third" },
  ],
};

const by = (r: ReturnType<typeof runBacktest>, k: string) => r.strategies.find((s) => s.key === k)!;

// ------------------------------------------------------- a flat, dead market
// Equities do nothing, cash pays 11%. Holding cash must win, and the ladder
// must never fire because the index never falls.
{
  const flat = series("2021-01-04", new Array(N).fill(50000));
  const r = runBacktest(flat, CFG);
  const cash = by(r, "cashOnly");
  const always = by(r, "alwaysIn");
  const ladder = by(r, "ladder");

  check("flat market: ladder never fires", ladder.buys === 0, ladder.buys);
  check("flat market: cash beats equities", cash.finalValue > always.finalValue, {
    cash: Math.round(cash.finalValue),
    always: Math.round(always.finalValue),
  });
  check(
    "flat market: always-in ends with no cash left",
    always.endCash < 30000,
    Math.round(always.endCash)
  );
  check(
    "flat market: always-in gets its money back and no more",
    Math.abs(always.finalValue - always.contributed) < 1,
    Math.round(always.finalValue - always.contributed)
  );
  check(
    "cash-only compounds at roughly the stated yield",
    cash.xirrPct !== null && Math.abs(cash.xirrPct - 11) < 0.4,
    cash.xirrPct?.toFixed(2)
  );
}

// ------------------------------------------------------ one deep V, then back
// Two years up, a 35% crash, then a full recovery. The ladder should fire every
// rung, buy well below the average level, and beat investing on arrival.
{
  const closes: number[] = [];
  const peak = 60000;
  for (let i = 0; i < 500; i++) closes.push(40000 + (peak - 40000) * (i / 499)); // grind up
  for (let i = 0; i < 200; i++) closes.push(peak * (1 - 0.35 * (i / 199))); // crash
  for (let i = 0; i < 600; i++) closes.push(peak * 0.65 + peak * 0.35 * (i / 599)); // recover
  const v = series("2021-01-04", closes);
  const r = runBacktest(v, CFG);
  const ladder = by(r, "ladder");
  const always = by(r, "alwaysIn");

  check("V-shape: every rung fires", ladder.buys >= 3, ladder.buys);
  // NOT asserted here: that the ladder buys below the period average. This run
  // opens 33% below its own peak and grinds up for two years, so the period
  // average is dragged down by prices that existed before there was a high to
  // fall from. The ladder buys below the HIGH, which is a different claim, and
  // the lump-sum run below is where it can be tested cleanly.
  check(
    "V-shape: the ladder beats investing on arrival",
    (ladder.xirrPct ?? 0) > (always.xirrPct ?? 0),
    { ladder: ladder.xirrPct?.toFixed(1), always: always.xirrPct?.toFixed(1) }
  );
  check(
    "V-shape: the ladder rides a smaller drawdown",
    Math.abs(ladder.maxDrawdownPct) < Math.abs(always.maxDrawdownPct),
    { ladder: ladder.maxDrawdownPct.toFixed(1), always: always.maxDrawdownPct.toFixed(1) }
  );
  check(
    "V-shape: always-in is nearly fully invested throughout",
    always.avgTimeInvestedPct > 95,
    always.avgTimeInvestedPct.toFixed(1)
  );
  check(
    "V-shape: the ladder holds real cash on average",
    ladder.avgTimeInvestedPct < always.avgTimeInvestedPct,
    ladder.avgTimeInvestedPct.toFixed(1)
  );
}

// --------------------------------------------- the same V, but with a lump sum
// No contributions, so both strategies hold the same money from day one and the
// only difference is WHEN it went in. Now "the ladder buys lower" is a claim
// with nothing else mixed into it.
{
  const closes: number[] = [];
  const peak = 60000;
  for (let i = 0; i < 300; i++) closes.push(peak); // sit at the high
  for (let i = 0; i < 200; i++) closes.push(peak * (1 - 0.35 * (i / 199))); // crash
  for (let i = 0; i < 800; i++) closes.push(peak * 0.65 + peak * 0.35 * (i / 799)); // recover
  const v = series("2021-01-04", closes);
  const r = runBacktest(v, { ...CFG, monthlyContribution: 0 });
  const ladder = by(r, "ladder");
  const always = by(r, "alwaysIn");

  check(
    "lump sum: the ladder's money goes in cheaper than money invested on arrival",
    ladder.avgBuyLevel < always.avgBuyLevel,
    { ladder: Math.round(ladder.avgBuyLevel), always: Math.round(always.avgBuyLevel) }
  );
  check(
    "lump sum: every ladder buy is below the high it measured from",
    ladder.avgBuyLevel < peak,
    Math.round(ladder.avgBuyLevel)
  );
  check(
    "lump sum: the ladder ends ahead",
    ladder.finalValue > always.finalValue,
    { ladder: Math.round(ladder.finalValue), always: Math.round(always.finalValue) }
  );
}

// ------------------------------------------------- a market that only goes up
// No fall ever reaches the first rung, so the ladder sits in cash and must lose
// to being invested. A backtest that cannot produce this result is rigged.
{
  const up = series(
    "2021-01-04",
    Array.from({ length: N }, (_, i) => 40000 * Math.pow(1.0008, i))
  );
  const r = runBacktest(up, CFG);
  const ladder = by(r, "ladder");
  const always = by(r, "alwaysIn");
  check("relentless bull: ladder loses to being invested", (ladder.xirrPct ?? 0) < (always.xirrPct ?? 0), {
    ladder: ladder.xirrPct?.toFixed(1),
    always: always.xirrPct?.toFixed(1),
  });
  check("relentless bull: ladder barely fires", ladder.buys <= 1, ladder.buys);
}

// ------------------------------------------------------------ the invariants
{
  // A sawtooth that crosses the 5% rung over and over. A rung must not refire
  // inside one cycle, so the trade count stays far below the number of crossings.
  const closes: number[] = [];
  for (let i = 0; i < N; i++) {
    const phase = i % 40;
    closes.push(phase < 20 ? 50000 - phase * 160 : 50000 - (40 - phase) * 160);
  }
  const saw = series("2021-01-04", closes);
  const r = runBacktest(saw, CFG);
  const ladder = by(r, "ladder");
  const cycles = Math.floor(N / 40);
  check("sawtooth: a rung fires once per cycle at most", ladder.buys <= cycles + 2, {
    buys: ladder.buys,
    cycles,
  });
}

{
  // The reserve is untouchable. With a single rung asking for the whole pool,
  // the ladder must still leave the reserve behind.
  const closes: number[] = [];
  for (let i = 0; i < 400; i++) closes.push(50000);
  for (let i = 0; i < 900; i++) closes.push(30000); // straight to a 40% fall
  const crash = series("2021-01-04", closes);
  const r = runBacktest(crash, { ...CFG, monthlyContribution: 0, rungs: [{ fallPct: 5, pct: 100 }] });
  const ladder = by(r, "ladder");
  check("reserve survives a full-pool rung", ladder.endCash > 9000, Math.round(ladder.endCash));
  check("only one buy when only one rung is set", ladder.buys === 1, ladder.buys);
}

{
  // No rungs at all means no buying, and the result must equal holding cash.
  const flat = series("2021-01-04", new Array(N).fill(50000));
  const r = runBacktest(flat, { ...CFG, rungs: [] });
  const ladder = by(r, "ladder");
  const cash = by(r, "cashOnly");
  check("no rungs behaves exactly like cash", Math.abs(ladder.finalValue - cash.finalValue) < 0.01, {
    ladder: Math.round(ladder.finalValue),
    cash: Math.round(cash.finalValue),
  });
  check("no rungs is called out in the notes", r.notes.some((n) => n.includes("No rungs")), r.notes.length);
}

{
  // Everyone is charged the same contributions, whatever they do with them.
  const flat = series("2021-01-04", new Array(N).fill(50000));
  const r = runBacktest(flat, CFG);
  const amounts = new Set(r.strategies.map((s) => Math.round(s.contributed)));
  check("every strategy is charged the same money", amounts.size === 1, [...amounts]);
}

{
  // Too little history must refuse rather than report a confident nothing.
  const short = series("2025-01-01", new Array(60).fill(50000));
  const r = runBacktest(short, CFG);
  check("short history refuses to run", r.strategies.length === 0, r.strategies.length);
  check("short history says why", r.notes.some((n) => n.includes("Not enough history")), r.notes[0]);
}

// ------------------------------------------------------------ the regime floor
{
  // Above a rising average is offense: a low floor. Below a falling one is
  // crisis: a high floor. These come straight from the live band table.
  const offense = regimeFloorFromIndex(60000, 58000, 55000, 3);
  const crisis = regimeFloorFromIndex(40000, 42000, 50000, -4);
  check("strong trend gives a low cash floor", offense <= 10, offense);
  check("broken trend gives a high cash floor", crisis >= 40, crisis);
  check("the floor moves the right way", crisis > offense, { offense, crisis });
}

{
  // The regime gate can only ever hold MORE cash back than the plain ladder, so
  // in a crash it must never end up more invested.
  const closes: number[] = [];
  for (let i = 0; i < 400; i++) closes.push(50000 + i * 20);
  for (let i = 0; i < 900; i++) closes.push(58000 * (1 - 0.45 * (i / 899)));
  const bear = series("2021-01-04", closes);
  const r = runBacktest(bear, CFG);
  const ladder = by(r, "ladder");
  const gated = by(r, "ladderRegime");
  check(
    "the regime gate never deploys more than the plain ladder",
    gated.deployed <= ladder.deployed + 1,
    { gated: Math.round(gated.deployed), ladder: Math.round(ladder.deployed) }
  );
  check(
    "in a long bear the gate is the safer of the two",
    Math.abs(gated.maxDrawdownPct) <= Math.abs(ladder.maxDrawdownPct) + 0.01,
    { gated: gated.maxDrawdownPct.toFixed(1), ladder: ladder.maxDrawdownPct.toFixed(1) }
  );
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
