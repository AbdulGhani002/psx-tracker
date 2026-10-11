// The KSE-100's buy zones (lib/strategy/zones) and the plan's parts in them.
//
//   npx tsx scripts/test-strategy-zones.ts

import { buyZones, mergeZones, pickZones, pivotLows, supportLevels, dailySigma, zoneWeights, type Close } from "../lib/strategy/zones";
import { strategyPlan, zoneRange, type StrategyInput } from "../lib/strategy/plan";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// Business days from 2025-01-01, one close each.
const series = (values: number[]): Close[] => {
  const out: Close[] = [];
  const d = new Date(Date.UTC(2025, 0, 1));
  for (const v of values) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ date: d.toISOString().slice(0, 10), close: v });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};
const line = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));

// Pivots: lowest for ten sessions either side; the last ten cannot be one.
const v = series([...line(200, 150, 30), ...line(150, 190, 30), ...line(190, 160, 15)]);
const piv = pivotLows(v);
check("a low held ten sessions either side is a pivot", piv.length === 1 && piv[0].close === 150, piv.map((p) => p.close).join());
check("the last ten sessions cannot be one yet", pivotLows(series([...line(200, 150, 30)])).length === 0);
check("of two equal lows, the first is the pivot", pivotLows(series([...line(160, 150, 15), 150, ...line(151, 170, 15)])).length === 1);
const groups = supportLevels([{ date: "2025-03-03", close: 150 }, { date: "2025-06-02", close: 152.5 }, { date: "2025-08-01", close: 170 }]);
check("lows within 2% are one level, with both dates", groups.length === 2 && groups[0].low === 150 && groups[0].high === 152.5 && groups[0].dates.length === 2);

// Sigma: a steady line has none; alternating ±1% days have about 1%.
check("no sigma on a steady rise", (dailySigma(series(line(100, 120, 120))) ?? 1) < 1e-3);
const zig = series(Array.from({ length: 300 }, (_, i) => 1000 * (i % 2 ? 1.01 : 1)));
check("about 1% a day on alternating 1% moves", near(dailySigma(zig)!, 0.00995, 0.0005), dailySigma(zig));
check("not enough closes: no sigma", dailySigma(series(line(100, 110, 40))) === null);

// The model's zone and cheap against T-bills, on a short steady series (no
// pivots, no sigma).
const short = series(line(160_000, 170_000, 40));
const z1 = buyZones({ closes: short, model: { buyHigh: 166_000, buyLow: 162_000 }, pe: 8.4, tbillPct: 12 });
check("the model's zone first, then cheap against T-bills", z1.map((z) => z.kind).join() === "model,value", z1.map((z) => `${z.kind} ${z.low}-${z.high}`).join(" | "));
check("the model's zone is the Model page's, untouched", z1[0].low === 162_000 && z1[0].high === 166_000 && z1[0].why === "Model, next 20 days");
check("cheap: an earnings yield 3 points over the T-bill", near(z1[1].high, (170_000 * (100 / 8.4)) / 15, 50) && near(z1[1].low, z1[1].high * 0.97, 60) && z1[1].why === "Cheap against T-bills", `${z1[1].low}-${z1[1].high}`);
const cheapNow = buyZones({ closes: short, model: null, pe: 5, tbillPct: 12 });
check("already cheap: the zone is today's level", cheapNow.length === 1 && cheapNow[0].high === 170_000 && cheapNow[0].why === "Cheap against T-bills now");
check("cheap only 60% under today: left out", buyZones({ closes: short, model: null, pe: 20, tbillPct: 12 }).length === 0);
check("no P/E or no T-bill: no value zone", buyZones({ closes: short, model: null, pe: null, tbillPct: 12 }).length === 0 && buyZones({ closes: short, model: null, pe: 8, tbillPct: null }).length === 0);
check("a model zone above today is ignored", buyZones({ closes: short, model: { buyHigh: 175_000, buyLow: 171_000 }, pe: null, tbillPct: null }).length === 0);

// Past lows: the nearest group under the model's zone.
const hist = series([...line(150_000, 180_000, 60), ...line(180_000, 150_000, 20), ...line(150_000, 190_000, 80), ...line(190_000, 170_000, 30)]);
const z2 = buyZones({ closes: hist, model: { buyHigh: 166_000, buyLow: 162_000 }, pe: null, tbillPct: null });
const sup = z2.find((z) => z.kind === "support");
check("past lows: the low of the dip, about 1% either side", sup != null && near(sup.low, 148_500, 60) && near(sup.high, 151_500, 60), sup && `${sup.low}-${sup.high}`);
check("past lows name the month", sup?.why === `Past lows, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(hist[79].date.slice(5, 7)) - 1]} ${hist[79].date.slice(2, 4)}`, sup?.why);
// Two past lows, like October 2025 and the crash of March 2026: the nearest
// and the next one at least 3% under it.
const twoDips = series([...line(150_000, 180_000, 120), ...line(180_000, 157_000, 25), ...line(157_000, 175_000, 40), ...line(175_000, 147_000, 25), ...line(147_000, 189_000, 60), ...line(189_000, 167_000, 40)]);
const z3 = buyZones({ closes: twoDips, model: { buyHigh: 163_600, buyLow: 159_400 }, pe: null, tbillPct: null }).filter((z) => z.kind === "support");
check("two past lows: the nearest, then one at least 3% deeper", z3.length === 2 && near(z3[0].high, 158_550, 60) && near(z3[1].low, 145_550, 60) && near(z3[1].high, 148_450, 60), z3.map((z) => `${z.low}-${z.high} ${z.why}`).join(" | "));
check("a month is named once", z3.every((z) => !/(\w{3} \d\d) and \1/.test(z.why) && /^Past lows, \w{3} \d\d( ·|$)/.test(z.why)), z3.map((z) => z.why).join(" | "));
const sameMonth = supportLevels([{ date: "2025-10-03", close: 157_000 }, { date: "2025-10-28", close: 157_900 }]);
check("two lows in one month: one group", sameMonth.length === 1 && sameMonth[0].dates.length === 2);
const far = series([...line(150_000, 100_000, 30), ...line(100_000, 190_000, 200), ...line(190_000, 170_000, 30)]);
check("lows from before a long rally are left out", !buyZones({ closes: far, model: null, pe: null, tbillPct: null }).some((z) => z.kind === "support"));

// A bad quarter: two three-month sigmas under today.
const wavy = series(Array.from({ length: 300 }, (_, i) => 170_000 * (i % 2 ? 1.01 : 1)));
const fall = buyZones({ closes: wavy, model: null, pe: null, tbillPct: null }).find((z) => z.kind === "fall")!;
const q = dailySigma(wavy)! * Math.sqrt(63), at = wavy[wavy.length - 1].close * Math.exp(-2 * q);
check("a bad quarter: two quarterly sigmas under today", fall != null && near(fall.low, at * Math.exp(-0.25 * q), 60) && near(fall.high, at * Math.exp(0.25 * q), 60) && fall.why === "A bad quarter, 1 in 20", fall && `${fall.low}-${fall.high} (at ${Math.round(at)})`);

// Zones never overlap. The value zone's top is set through the P/E: at a top
// of `t`, the P/E is 100 * 170,000 / (15 * t).
const valueTop = (t: number) => buyZones({ closes: short, model: { buyHigh: 166_000, buyLow: 162_000 }, pe: (100 * 170_000) / (15 * t), tbillPct: 12 });
const inside = valueTop(165_000);
check("a zone mostly inside the one above: one zone, both reasons", inside.length === 1 && inside[0].why === "Model, next 20 days · Cheap against T-bills" && inside[0].high === 166_000 && inside[0].low === 160_050, inside.map((z) => `${z.kind} ${z.low}-${z.high} ${z.why}`).join(" | "));
const partly = valueTop(163_000);
check("a zone partly inside: starts where the one above ends", partly.length === 2 && partly[1].kind === "value" && partly[1].high === 162_000 && partly[1].low === 158_100, partly.map((z) => `${z.kind} ${z.low}-${z.high}`).join(" | "));
const apart = valueTop(161_000);
check("zones next to each other stay apart", apart.length === 2 && apart[1].high === 161_000);
const thin = mergeZones([
  { kind: "model", low: 162_000, high: 166_000, why: "A" },
  { kind: "support", low: 161_200, high: 162_600, why: "B" },
]);
check("a sliver under 1% after the cut goes into the zone above", thin.length === 1 && thin[0].low === 162_000 && thin[0].why === "A · B", thin.map((z) => `${z.low}-${z.high} ${z.why}`).join(" | "));
const wide = mergeZones([
  { kind: "model", low: 160_000, high: 162_000, why: "A" },
  { kind: "fall", low: 148_000, high: 161_000, why: "B" },
]);
check("a merge never makes a zone over 6% wide: cut instead", wide.length === 2 && wide[1].high === 160_000 && wide[1].low === 148_000, wide.map((z) => `${z.low}-${z.high} ${z.why}`).join(" | "));
const five = pickZones([
  { kind: "model", low: 159_400, high: 163_600, why: "M" },
  { kind: "support", low: 155_150, high: 158_500, why: "S1" },
  { kind: "support", low: 145_000, high: 150_250, why: "S2" },
  { kind: "fall", low: 136_000, high: 141_000, why: "F" },
  { kind: "value", low: 129_700, high: 133_700, why: "V" },
]);
check("five zones: the bad quarter goes, past lows stay", five.length === 4 && five.map((z) => z.why).join() === "M,S1,S2,V", five.map((z) => z.why).join());
const fourOnly = pickZones([
  { kind: "model", low: 159_400, high: 163_600, why: "M" },
  { kind: "support", low: 155_150, high: 158_500, why: "S1" },
  { kind: "fall", low: 136_000, high: 141_000, why: "F" },
  { kind: "value", low: 129_700, high: 133_700, why: "V" },
]);
check("four zones: all kept, the bad quarter too", fourOnly.length === 4 && fourOnly.some((z) => z.kind === "fall"));
check("merging leaves its input alone", (() => { const a = [{ kind: "model" as const, low: 1, high: 3, why: "x" }, { kind: "fall" as const, low: 2, high: 2.5, why: "y" }]; mergeZones(a); return a[0].low === 1 && a[0].why === "x"; })());
const all = buyZones({ closes: hist, model: { buyHigh: 166_000, buyLow: 162_000 }, pe: 8.4, tbillPct: 12 });
check("deepest last, at most four, never overlapping", all.length <= 4 && all.every((z, k) => k === 0 || z.high < all[k - 1].low), all.map((z) => `${z.kind} ${z.low}-${z.high}`).join(" | "));
check("weights: more the deeper, adding to one", [1, 2, 3, 4].every((n) => near(zoneWeights(n).reduce((s, x) => s + x, 0), 1, 1e-9)) && zoneWeights(4).every((x, k, a) => k === 0 || x >= a[k - 1]));

// The plan's parts go into the zones.
const input: StrategyInput = {
  today: "2026-10-11",
  profile: { risk: "balanced", horizon: "long" },
  kse: { level: 156_000, high: 200_000, highDate: "2026-06-30", ma200: 170_000 },
  market: { pe: 8.4, cape: 7.4, dividendYieldPct: 6 },
  rates: { month: "2026-10", policyPct: 11, tbill3mPct: 10.9, tbill6mPct: 10.8, tbill12mPct: 11, sukukPct: 11.4, savingsPct: 9.5, moneyMarketPct: 10.4, inflationPct: 5, taxPct: 15 },
  prevRates: null,
  book: { stocks: 550_000, equityFunds: 0, cashLike: 300_000, fixedIncome: 150_000 },
  names: [],
  zones: [
    { kind: "model", low: 150_000, high: 153_000, why: "Model, next 20 days" },
    { kind: "support", low: 140_000, high: 144_000, why: "Past lows, Mar 26" },
    { kind: "value", low: 125_000, high: 129_000, why: "Cheap against T-bills" },
  ],
};
const plan = strategyPlan(input);
check("one part per zone, its range and why", plan.tranches.length === 3 && plan.tranches[1].kind === "support" && plan.tranches[1].low === 140_000 && plan.tranches[1].high === 144_000 && plan.tranches[1].why === "Past lows, Mar 26");
check("the money: 25, 35 and 40% of the room", near(plan.tranches[0].amount, plan.allocation.room * 0.25, 1) && near(plan.tranches[2].amount, plan.allocation.room * 0.4, 1) && plan.allocation.room > 0);
check("a zone is reached once the index is at or under its top", plan.tranches.every((t) => !t.due) && strategyPlan({ ...input, kse: { ...input.kse!, level: 144_000 } }).tranches.filter((t) => t.due).length === 2);
check("how far under the high each zone's top is", near(plan.tranches[0].drawdownPct, 23.5, 1e-9));
check("the next step names the zone's range", plan.steps.some((x) => x === `Next: Rs ${Math.round(plan.tranches[0].amount).toLocaleString("en-US")} at KSE-100 150,000–153,000`), plan.steps.join(" | "));
check("a range reads low to high; a single level as itself", zoneRange({ low: 150_000, high: 153_000, kseLevel: 153_000 }) === "150,000–153,000" && zoneRange({ low: null, high: 190_000, kseLevel: 190_000 }) === "190,000");
const noZones = strategyPlan({ ...input, zones: [] });
check("without zones: quarters at 5, 10, 20 and 30% under the high", noZones.tranches.length === 4 && noZones.tranches.map((t) => t.kseLevel).join() === "190000,180000,160000,140000" && noZones.tranches[2].why === "20% under the high");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
