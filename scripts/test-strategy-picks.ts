// What to do with a researched share and with a held one (lib/strategy/picks),
// what the system learns (lib/macro/learn), and the P/E history behind it
// (lib/macro/valuation).
//
//   npx tsx scripts/test-strategy-picks.ts

import { buyPick, sellPick, type PickInput } from "../lib/strategy/picks";
import { ROUND_TRIP, liveCalibration, blendCalibration, edgeAt, valueEffect, expectedEdge, yieldOn } from "../lib/macro/learn";
import { calibrate } from "../lib/macro/artifact";
import { fiscalEnd, epsOnToday, epsKnownOn, peHistory, usualPe, type PePoint } from "../lib/macro/valuation";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

// --- the calls -----------------------------------------------------------------
const base: PickInput = { symbol: "MARI", price: 560, edge: 0.015, thin: false, zone: { buyLow: 540, buyHigh: 545, sellLow: 600, sellHigh: 630 } };
check("costs there and back: 1%", ROUND_TRIP === 0.01);
check("an edge over the costs, over the zone: buy at the zone's top", buyPick(base).verdict === "buy-at" && buyPick(base).buyAt === 545);
check("at or under the zone's top: buy now, at the price", buyPick({ ...base, price: 545 }).verdict === "buy" && buyPick({ ...base, price: 540.4 }).buyAt === 540);
check("no zone: buy now", buyPick({ ...base, zone: null }).verdict === "buy");
check("an edge under the costs: wait, with the zone's top for reference", buyPick({ ...base, edge: 0.0099 }).verdict === "wait" && buyPick({ ...base, edge: 0.0099 }).buyAt === 545 && buyPick({ ...base, edge: -0.0099 }).verdict === "wait");
check("an edge under minus the costs: avoid", buyPick({ ...base, edge: -0.01 }).verdict === "avoid" && buyPick({ ...base, edge: -0.03 }).buyAt === null);
check("an edge of exactly the costs is a buy", buyPick({ ...base, edge: 0.01 }).verdict === "buy-at");
check("thin trading: no call; no price or no edge: unknown", buyPick({ ...base, thin: true }).verdict === "thin" && buyPick({ ...base, price: null }).verdict === "unknown" && buyPick({ ...base, edge: null }).verdict === "unknown");
check("held, edge positive: hold, with the zone's top for reference", sellPick(base).verdict === "hold" && sellPick(base).sellAt === 630);
check("held, edge under nothing: take profit at the bottom of the sell zone", sellPick({ ...base, edge: -0.004 }).verdict === "take-profit" && sellPick({ ...base, edge: -0.004 }).sellAt === 600);
check("already over the sell zone: take profit at the price", sellPick({ ...base, edge: -0.004, price: 612 }).sellAt === 612);
check("held, edge under minus the costs: sell now", sellPick({ ...base, edge: -0.012 }).verdict === "sell" && sellPick({ ...base, edge: -0.012 }).sellAt === 560);
check("held and thin: no call; no edge: unknown", sellPick({ ...base, thin: true }).verdict === "thin" && sellPick({ ...base, edge: null }).verdict === "unknown");

// --- what it learns --------------------------------------------------------------
const tested = [-0.03, -0.011, -0.008, 0.002, 0.005, 0.012, 0.011, 0.013, 0.015, 0.02].map((rel3, d) => ({ lo: d / 10, hi: (d + 1) / 10, rel3, hit: 0.5, n: 3000 }));
check("the edge at a tenth's middle is the tenth's", near(edgeAt(tested, 0.95), 0.02) && near(edgeAt(tested, 0.05), -0.03) && near(edgeAt(tested, 0.55), 0.012));
check("between middles, straight between them; past the ends, the end's", near(edgeAt(tested, 0.5), 0.0085) && near(edgeAt(tested, 1), 0.02) && near(edgeAt(tested, 0), -0.03));
const live = liveCalibration([{ pctile: 0.97, rel3: 0.05 }, { pctile: 0.91, rel3: -0.01 }, { pctile: 0.02, rel3: -0.02 }, { pctile: 1, rel3: 0.04 }]);
check("live outcomes by tenth: the mean, how often over nothing, how many", near(live[9].rel3, 0.08 / 3) && near(live[9].hit, 2 / 3) && live[9].n === 3 && live[0].n === 1 && live[5].n === 0);
const blended = blendCalibration(tested, live, 3);
check("blended: a tenth moves halfway when its live count equals the weight", near(blended[9].rel3, (0.02 + 0.08 / 3) / 2) && near(blended[0].rel3, -0.03 * 0.75 + -0.02 * 0.25) && blended[5].rel3 === 0.012);
check("no live outcomes: the record alone", blendCalibration(tested, null) === tested);
// What each tenth did: ranks against returns within each month.
const panel = Array.from({ length: 40 }, (_, k) => ({ date: k < 20 ? "2020-01-31" : "2020-02-28", symbol: `S${k}`, sector: "", x: [], fwd1: null, fwd3: Math.log(1 + (k % 20) / 100), fwd6: null, pct3: null }));
const cal = calibrate(panel as any, panel.map((_, k) => k % 20));
check("the record's tenths from ranked months", cal.length === 10 && cal[0].n === 4 && near(cal[0].rel3, 0.005) && near(cal[9].rel3, 0.185) && cal[0].hit === 0.5 && cal[9].hit === 1, JSON.stringify(cal.map((c) => +c.rel3.toFixed(3))));
check("a month with fewer than 20 scored names is left out", calibrate(panel.slice(0, 19) as any, panel.slice(0, 19).map((_, k) => k)).every((c) => c.n === 0));
// The value effect: found where it is there, not where it is not.
const obs = Array.from({ length: 400 }, (_, k) => {
  const value = Math.sin(k * 1.7) * 0.4;
  return { date: `q${k % 10}`, value, rel3: -0.05 * value + 0.01 * Math.cos(k * 3.1) };
});
const ve = valueEffect(obs);
check("a real link: its slope, and it holds", near(ve.beta, -0.05, 0.005) && ve.holds && ve.quarters === 10 && ve.n === 400, `${ve.beta.toFixed(4)} t ${ve.t.toFixed(1)}`);
const noise = valueEffect(obs.map((o, k) => ({ ...o, rel3: 0.01 * Math.cos(k * 3.1) })));
check("noise does not hold", !noise.holds);
check("too few readings: nothing", !valueEffect(obs.slice(0, 20)).holds && valueEffect(obs.slice(0, 20)).beta === 0);
check("the expected edge adds the value effect only where it holds", near(expectedEdge(tested, 0.95, 1.2, ve), 0.02 + ve.beta * Math.log(1.2)) && near(expectedEdge(tested, 0.95, 1.2, noise), 0.02) && expectedEdge(tested, null, 1, ve) === null && near(expectedEdge(tested, 0.95, null, ve), 0.02));
check("and only so far: a P/E three times its usual counts as two-thirds over", near(expectedEdge(tested, 0.95, 3, ve), 0.02 + ve.beta * 0.5));
// Pooled, 600 readings from 10 quarters look strong; quarter by quarter, the
// link flips sign and does not hold.
const flips = Array.from({ length: 600 }, (_, k) => {
  const q = k % 10, value = Math.sin(k * 1.3) * 0.4;
  return { date: `q${q}`, value, rel3: (q < 6 ? 0.06 : -0.04) * value };
});
const fl = valueEffect(flips);
check("a link that flips between quarters does not hold, however many readings", !fl.holds && fl.quarters === 10, `beta ${fl.beta.toFixed(4)} t ${fl.t.toFixed(2)}`);
const divs = [{ date: "2025-03-10", yieldPct: 2 }, { date: "2025-09-01", yieldPct: 3 }, { date: "2026-03-09", yieldPct: 2.5 }];
check("the yield over the year to a date", near(yieldOn(divs, "2025-06-30"), 2) && near(yieldOn(divs, "2026-06-30"), 5.5) && near(yieldOn(divs, "2026-03-08"), 5) && yieldOn([], "2026-06-30") === 0);

// --- the P/E history -------------------------------------------------------------
check("a financial year's last day", fiscalEnd(2025, 6) === "2025-06-30" && fiscalEnd(2025, 12) === "2025-12-31" && fiscalEnd(2024, 2) === "2024-02-29");
// Profit in thousands over today's shares: a split restated one year and not
// the one before; on today's count both read the same way.
const rows = [
  { fiscalYear: 2023, eps: 43.06, profitAfterTax: 13_725_814 },
  { fiscalYear: 2024, eps: 18.91, profitAfterTax: 28_106_539 },
  { fiscalYear: 2025, eps: null, profitAfterTax: null },
];
const years = epsOnToday(rows, 1_465_000_000, 6);
check("earnings on today's share count, a year without either left out", years.length === 2 && near(years[0].eps, 9.369, 1e-3) && near(years[1].eps, 19.185, 1e-3) && years[0].end === "2023-06-30", JSON.stringify(years));
check("the reported EPS when the share count is unknown", epsOnToday(rows, null, 6)[0].eps === 43.06);
check("losses are kept", epsOnToday([{ fiscalYear: 2024, eps: -2, profitAfterTax: null }], null, 12)[0].eps === -2);
check("a year counts three months after it ends", epsKnownOn(years, "2023-09-28") === null && near(epsKnownOn(years, "2023-09-30"), 9.369, 1e-3) && near(epsKnownOn(years, "2024-12-31"), 19.185, 1e-3) && epsKnownOn(years, "2022-12-31") === null);
const price = (d: string) => ({ "2023-12-31": 120, "2024-06-30": 150, "2024-12-31": 200, "2025-06-30": 5000 } as Record<string, number>)[d] ?? null;
const rate = (d: string) => (d < "2024-06-10" ? 22 : d < "2025-05-05" ? 15 : 11);
const pts = peHistory(["2023-06-30", "2023-12-31", "2024-06-30", "2024-12-31", "2025-06-30"], price, years, rate);
check("P/E on each date from the earnings known then; none before them or over 100", pts.length === 3 && pts[0].date === "2023-12-31" && near(pts[0].pe, 120 / 9.369, 1e-2) && near(pts[2].pe, 200 / 19.185, 1e-2) && pts[0].rate === 22 && pts[2].rate === 15, JSON.stringify(pts));
// Quarter ends at the rates of 2023 to 2026, a P/E for each.
const rates = [22, 22, 20.5, 17.5, 13, 12, 11, 11, 10.5, 10.5, 11.5, 11.5];
const series = (pes: number[]): PePoint[] => pes.map((pe, k) => ({ date: `q${k}`, pe, rate: rates[k] }));
const pts12 = series([3, 4, 4.5, 5, 6, 7, 7.5, 8, 9, 8.5, 10, 11]);
check("the usual P/E: the median of the readings within 2.5 points of today's rate", usualPe(pts12, 11.5) === 8.25 && usualPe(pts12, 21) === 4, `${usualPe(pts12, 11.5)} ${usualPe(pts12, 21)}`);
check("fewer than three near today's rate: within 4 points", usualPe(series([3, 4, 4.5, 5, 6]), 16.5) === 5, usualPe(series([3, 4, 4.5, 5, 6]), 16.5));
check("still fewer, or no rate today: none", usualPe(series([3, 4]), 11.5) === null && usualPe(pts12, null) === null && usualPe([{ date: "a", pe: 9, rate: null }, { date: "b", pe: 9, rate: null }, { date: "c", pe: 9, rate: null }], 11.5) === null);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
