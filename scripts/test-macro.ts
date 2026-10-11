// The strategy model's building blocks: the macro state as known at a date
// (lib/macro/series), the monthly panel (lib/macro/panel) with no look-ahead,
// and the learners and their test (lib/macro/models).
//
//   npx tsx scripts/test-macro.ts

import { valueOn, monthsBack, logChange, cpiOn, gdpOn, macroState, MACRO_NAMES, type MacroInputs, type Point } from "../lib/macro/series";
import { buildPanel, ranks, slope, barAt, STOCK_NAMES, type PanelInput } from "../lib/macro/panel";
import { fitRidge, predictRidge, spearman, scoreMonths, summarise, walkForward } from "../lib/macro/models";
import { trainMlp, predictMlp } from "../lib/macro/mlp";
import type { EodBar } from "../lib/timeseries/psx-eod";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}
const near = (a: number | null, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

// --- the series ---------------------------------------------------------------
const s: Point[] = [["2026-01-05", 10], ["2026-02-02", 11], ["2026-03-02", 12]];
check("a value on or before a date", valueOn(s, "2026-01-01") === null && valueOn(s, "2026-01-05") === 10 && valueOn(s, "2026-02-20") === 11 && valueOn(s, "2027-01-01") === 12);
check("months back, clamped to the month's end", monthsBack("2026-03-31", 1) === "2026-02-28" && monthsBack("2026-03-31", 12) === "2025-03-31" && monthsBack("2024-03-31", 1) === "2024-02-29" && monthsBack("2026-01-15", 3) === "2025-10-15");
check("a change over months, and none before the series starts", near(logChange(s, "2026-03-02", 1), Math.log(12 / 11)) && logChange(s, "2026-01-31", 1) === null);
check("a lagged change reads the day before", near(logChange(s, "2026-03-02", 1, true), Math.log(11 / 10)));
const cpiMonthly = Array.from({ length: 30 }, (_, k) => ({ period: monthsBack("2024-07-15", -k).slice(0, 7), index: 100 * Math.pow(1.01, k) }));
const annual: Array<[number, number]> = [[2023, 30], [2024, 12.6], [2025, 3.5]];
const cpiAug26 = cpiOn("2026-09-30", cpiMonthly, annual);
check("inflation from PBS: last month's index against a year before", near(cpiAug26, (Math.pow(1.01, 12) - 1) * 100, 1e-6), cpiAug26?.toFixed(3));
check("before PBS's year of history: the World Bank's previous year", cpiOn("2025-05-31", cpiMonthly, annual) === 12.6 && cpiOn("2024-03-31", cpiMonthly, annual) === 30);
check("growth: last year's from July, the year before until then", gdpOn("2026-03-31", [[2024, 3.1], [2025, 3.7]]) === 3.1 && gdpOn("2026-07-31", [[2024, 3.1], [2025, 3.7]]) === 3.7);

const flat = (from: string, n: number, v: number): Point[] => Array.from({ length: n }, (_, k) => [new Date(Date.parse(from) + k * 86400000).toISOString().slice(0, 10), v] as Point);
const inputs: MacroInputs = {
  policy: [["2025-01-01", 12], ["2026-04-28", 11.5]],
  cpiMonthly,
  cpiAnnual: annual,
  gdpAnnual: [[2024, 3.1], [2025, 3.7]],
  oil: flat("2024-01-01", 1200, 80),
  gold: flat("2024-01-01", 1200, 2000),
  usdpkr: flat("2024-01-01", 1200, 280),
  spx: flat("2024-01-01", 1200, 5000),
  em: flat("2024-01-01", 1200, 40),
  dxy: flat("2024-01-01", 1200, 100),
  us10y: flat("2024-01-01", 1200, 4.5),
  market: flat("2024-01-01", 1200, 1000),
};
const st = macroState("2026-09-30", inputs);
const at = (n: (typeof MACRO_NAMES)[number]) => st[MACRO_NAMES.indexOf(n)];
check("the state: the policy rate and its direction", at("policy") === 11.5 && at("policyChg6") === -0.5 && at("policyChg12") === -0.5);
check("the real rate is the policy rate less inflation", near(at("realRate"), 11.5 - at("cpi")!, 1e-9));
check("flat world prices move nothing; the market is at its high", at("oil3") === 0 && at("pkr12") === 0 && at("us10yChg3") === 0 && at("mktDd12") === 0);

// --- the panel: nothing from after the month's end ------------------------------
const days: string[] = [];
for (let d = Date.parse("2023-01-02"); days.length < 700; d += 86400000) {
  const w = new Date(d).getUTCDay();
  if (w !== 0 && w !== 6) days.push(new Date(d).toISOString().slice(0, 10));
}
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const mk = (drift: number): EodBar[] => {
  let p = 100;
  return days.map((date) => ({ date, close: (p *= Math.exp(drift + 0.02 * rnd())), volume: 1e5, vwap: p }));
};
const names = Array.from({ length: 14 }, (_, i) => `S${i}`);
const bars = new Map(names.map((n, i) => [n, mk((i - 7) * 0.0002)]));
const market: EodBar[] = days.map((date, k) => ({ date, close: names.reduce((a, n) => a + bars.get(n)![k].close, 0) / names.length, volume: 0, vwap: 0 }));
const monthEnds = days.filter((d, k) => k === days.length - 1 || days[k + 1].slice(0, 7) !== d.slice(0, 7));
const base: PanelInput = {
  bars,
  dividends: new Map([["S1", [{ date: days[300], yieldPct: 5 }]]]),
  sectorOf: (sym) => (Number(sym.slice(1)) % 2 ? "ODD" : "EVEN"),
  members: () => new Set(names),
  market,
  monthEnds,
  macro: () => MACRO_NAMES.map(() => 0),
  factorMonthly: () => ({ oil: 0.01, pkr: 0, gold: 0, policy: 0, spx: 0 }),
  factorPush: () => ({ oil: 0.03, pkr: 0, gold: 0, policy: 0, spx: 0 }),
};
const rows = buildPanel(base);
const probe = monthEnds[20];
const changed = new Map(bars);
const s3 = bars.get("S3")!.map((b) => ({ ...b }));
for (let k = barAt(s3, probe) + 1; k < s3.length; k++) s3[k].close *= 2;
changed.set("S3", s3);
const rows2 = buildPanel({ ...base, bars: changed });
const r1 = rows.find((r) => r.date === probe && r.symbol === "S3")!, r2 = rows2.find((r) => r.date === probe && r.symbol === "S3")!;
check("the panel has a row per name per month once a year of history exists", rows.length > 0 && rows.every((r) => r.date >= days[252]), rows.length);
check("changing what happens after a month's end changes none of its features", JSON.stringify(r1.x) === JSON.stringify(r2.x));
check("only the targets see the future", r1.fwd3 !== r2.fwd3);
const dyAt = rows.find((r) => r.symbol === "S1" && r.date >= days[300] && r.date < days[330])!;
check("a dividend counts for a year after its date", dyAt.x[STOCK_NAMES.indexOf("dy")] === 5 && rows.filter((r) => r.symbol === "S1" && r.date < days[300]).every((r) => r.x[STOCK_NAMES.indexOf("dy")] === 0));
check("percentile targets run 0 to 1 within a month", rows.filter((r) => r.date === probe && r.pct3 != null).every((r) => r.pct3! >= 0 && r.pct3! <= 1));

// --- helpers ------------------------------------------------------------------
check("ranks: ties share, unknowns stay unknown", JSON.stringify(ranks([3, 1, 3, NaN])) === JSON.stringify([0.75, 0, 0.75, NaN]));
check("the slope of a line, and none on too little", near(slope(Array.from({ length: 20 }, (_, i) => 2 * i + 1), Array.from({ length: 20 }, (_, i) => i)), 2, 1e-9) && Number.isNaN(slope([1, 2], [1, 2])));
check("rank correlation: perfect, reversed, unknowns skipped", near(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1) && near(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1) && near(spearman([1, 2, NaN, 3, 4, 5], [1, 2, 9, 3, 4, 5]), 1));
const X = Array.from({ length: 300 }, (_, i) => [Math.sin(i), Math.cos(i * 1.7), NaN]);
const y = X.map((x) => 3 * x[0] - 2 * x[1] + 1);
const m = fitRidge(X, y, 1e-6);
check("ridge recovers a line; an unknown column is ignored", near(predictRidge(m, [0.5, 0.2, NaN]), 3 * 0.5 - 2 * 0.2 + 1, 1e-3), predictRidge(m, [0.5, 0.2, NaN]).toFixed(4));

// The network learns a bend a straight line cannot, and keeps its best epoch.
const XS = Array.from({ length: 3000 }, (_, i) => [Math.sin(i * 0.37) * 2, Math.cos(i * 0.11) * 2, NaN]);
const YS = XS.map((x) => (x[0] > 0 ? x[0] : 0) + 0.3 * x[1] * x[1]);
const net = trainMlp(XS, YS, { hidden: [16, 8], epochs: 60, lr: 3e-3, dropout: 0, seed: 5 });
const lin = fitRidge(XS, YS, 1e-6);
const mse = (f: (x: number[]) => number) => XS.slice(2500).reduce((s, x, k) => s + (f(x) - YS[2500 + k]) ** 2, 0) / 500;
check("the network fits a curve better than a line", mse((x) => predictMlp(net, x)) < 0.5 * mse((x) => predictRidge(lin, x)), `${mse((x) => predictMlp(net, x)).toFixed(4)} vs ${mse((x) => predictRidge(lin, x)).toFixed(4)}`);
check("the same seed trains the same network", JSON.stringify(trainMlp(XS.slice(0, 400), YS.slice(0, 400), { hidden: [4], epochs: 3, seed: 9 }).W) === JSON.stringify(trainMlp(XS.slice(0, 400), YS.slice(0, 400), { hidden: [4], epochs: 3, seed: 9 }).W));

const months = rows.filter((r) => r.fwd3 != null);
const perfect = summarise(scoreMonths(months, months.map((r) => r.fwd3!)));
const reversed = summarise(scoreMonths(months, months.map((r) => -r.fwd3!)));
check("a perfect forecast scores an IC of 1 and a positive spread", near(perfect.ic, 1, 1e-9) && perfect.spread > 0 && perfect.hit === 1);
check("its opposite scores -1", near(reversed.ic, -1, 1e-9) && reversed.spread < 0);
const seen: string[] = [];
walkForward(rows.map((r) => ({ ...r, pct3: r.pct3 ?? 0.5 })), (train) => {
  seen.push(train[train.length - 1].date);
  return () => 0;
}, { fromYear: 2024, toYear: 2025 });
check("a test year trains only on months three months or more before it", seen.every((d, k) => d < `${2024 + k - 1}-10-01` || d < "2025-10-01"), seen.join(","));

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
