// What the macro history says about Pakistan's market, from the exchange's
// 24-year archive and the macro series (lib/macro/analytics.ts):
//   1. how each sector moves against the market with oil, the rupee, gold,
//      the policy rate and US stocks, month by month;
//   2. whether the macro state told when stocks would beat T-bills, walked
//      forward, against holding stocks always and against the 200-day trend;
//   3. the past months most like the latest one, and what followed.
//
//   NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/macro-study.ts --panel C:/CC/Data/macro/panel.json
//        --archive C:/CC/Data/psx-history --macro C:/CC/Data/macro [--out C:/CC/Data/macro/study.json]

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { loadArchive, membership, equalWeightIndex } from "../lib/quant/archive";
import { macroState, MACRO_NAMES, logChange, valueOn, monthsBack, type MacroInputs, type Point } from "../lib/macro/series";
import { sectorSensitivities, timingWalk, analogs, type TimingMonth, type MonthState } from "../lib/macro/analytics";
import { displaySector } from "../lib/calculations/sector-weights";
import history from "../lib/macro/pk-history.json";
import { argOf } from "./quant-cli";

const MACRO = argOf("macro") || "C:/CC/Data/macro";
const panel = JSON.parse(readFileSync(argOf("panel") || join(MACRO, "panel.json"), "utf8")) as { names: string[]; rows: Array<[string, string, string, Array<number | null>, number | null, number | null, number | null, number | null]> };
const col = (n: string) => panel.names.indexOf(n);

const bars = loadArchive(argOf("archive") || "C:/CC/Data/psx-history");
const market = equalWeightIndex(bars, membership(bars, 120), 10, true);
const dump = JSON.parse(gunzipSync(readFileSync(join(MACRO, "macro-dump.json.gz"))).toString()) as { macro: { [k: string]: Point[] }; cpi: Array<{ period: string; index: number }> };
const inputs: MacroInputs = {
  policy: history.policy as Point[],
  cpiMonthly: dump.cpi,
  cpiAnnual: history.cpiAnnual as Array<[number, number]>,
  gdpAnnual: history.gdpAnnual as Array<[number, number]>,
  oil: dump.macro.oil, gold: dump.macro.gold, usdpkr: dump.macro.usdpkr, spx: dump.macro.spx, em: dump.macro.em, dxy: dump.macro.dxy, us10y: dump.macro.us10y,
  market: market.map((b) => [b.date, b.close] as Point),
};
const months = [...new Set(panel.rows.map((r) => r[0]))].sort();
// The state "times like now" compares: rates, their direction, inflation, the
// real rate, a year of oil, the rupee, gold and US stocks, and the market's own
// fall and year.
const ANALOG = ["policy", "policyChg12", "cpi", "realRate", "oil12", "pkr12", "gold12", "spx12", "mktDd12", "mktRet12"] as const;
const PICK = ANALOG.map((n) => MACRO_NAMES.indexOf(n));
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%` : "n/a");

// --- 1. sensitivities ----------------------------------------------------------
const FACT = ["oil", "rupee", "gold", "policy", "US stocks"];
const factorsOf = (date: string): number[] => [
  logChange(inputs.oil, date, 1, true) ?? NaN,
  logChange(inputs.usdpkr, date, 1) ?? NaN,
  logChange(inputs.gold, date, 1, true) ?? NaN,
  (() => { const a = valueOn(inputs.policy, date), b = valueOn(inputs.policy, monthsBack(date, 1)); return a != null && b != null ? a - b : NaN; })(),
  logChange(inputs.spx, date, 1, true) ?? NaN,
];
const factors = new Map(months.map((d) => [d, factorsOf(d)]));
const monthly = months.map((date) => {
  const sectors = new Map<string, { rel: number; n: number; sum: number }>();
  for (const r of panel.rows) {
    if (r[0] !== date || !r[2]) continue;
    const rel = r[3][col("rel1")];
    if (rel == null) continue;
    const s = sectors.get(r[2]) ?? sectors.set(r[2], { rel: 0, n: 0, sum: 0 }).get(r[2])!;
    s.sum += rel;
    s.n++;
  }
  for (const s of sectors.values()) s.rel = s.sum / s.n;
  return { date, sectors };
});
const sens = sectorSensitivities(monthly, factors, 60).filter((s) => s.names >= 2.5);
console.log(`\n1. What moves each sector against the market, per month (${FACT.join(", ")}): beta (t)`);
console.log(`   oil, rupee, gold, US stocks: return per 10% move; policy: per 1-point move`);
for (const s of sens) {
  const cells = s.beta.map((b, j) => {
    const per = FACT[j] === "policy" ? b : b * 0.1;
    const mark = Math.abs(s.t[j]) >= 2 ? "*" : " ";
    return `${FACT[j]} ${pct(per)}${mark}(${s.t[j].toFixed(1)})`;
  });
  console.log(`   ${displaySector(s.sector).slice(0, 34).padEnd(34)} ${String(Math.round(s.names)).padStart(2)} names  ${cells.join("  ")}  R2 ${(s.r2 * 100).toFixed(0)}%`);
}

// --- 2. timing -----------------------------------------------------------------
const mi = (date: string) => market.findIndex((b) => b.date === date);
const timing: TimingMonth[] = months.map((date) => {
  const i = mi(date);
  const fwd = i >= 0 && i + 63 < market.length ? Math.log(market[i + 63].close / market[i].close) : null;
  const cash = ((valueOn(inputs.policy, date) ?? 10) / 100) * (63 / 252);
  return { date, x: macroState(date, inputs).map((v) => (v == null ? NaN : v)), stock: fwd, cash, excess: fwd == null ? null : fwd - cash };
});
const FROM = 2008;
const ridge = timingWalk(timing, FROM, 50);
const trend = timingWalk(timing, FROM, 50, (m) => {
  const i = mi(m.date);
  if (i < 200) return 1;
  let s = 0;
  for (let k = i - 199; k <= i; k++) s += market[k].close;
  return market[i].close > s / 200 ? 1 : -1;
});
const always = timingWalk(timing, FROM, 50, () => 1);
const lagged = (date: string) => timing.find((t) => t.date === date);
const analogSignal = timingWalk(timing, FROM, 50, (m, train) => {
  const state = (t: TimingMonth): MonthState => ({ date: t.date, x: PICK.map((j) => t.x[j]) });
  const near = analogs(train.map(state), state(m), 8, 3);
  const ex = near.map((a) => lagged(a.date)?.excess).filter((v): v is number => v != null);
  return ex.length ? ex.reduce((s, v) => s + v, 0) / ex.length : 0;
});
const line = (name: string, r: typeof ridge.rec) => console.log(`   ${name.padEnd(28)} corr ${Number.isFinite(r.corr) ? r.corr.toFixed(2) : " n/a"}  sign right ${(r.hit * 100).toFixed(0)}%  in stocks ${(r.inStocks * 100).toFixed(0)}%  a year ${pct(r.cagr)} worst fall ${pct(r.maxDd, 0)}`);
console.log(`\n2. When stocks beat T-bills over the next 3 months, ${FROM} on (every third month, ${ridge.rec.months} periods; holding stocks always: ${pct(always.rec.holdCagr)} a year, worst fall ${pct(always.rec.holdMaxDd, 0)})`);
line("macro ridge", ridge.rec);
line("times like now (8 analogs)", analogSignal.rec);
line("200-day trend", trend.rec);

// --- 3. now ----------------------------------------------------------------------
const names = [...ANALOG];
const states = timing.map((t) => ({ date: t.date, x: PICK.map((j) => t.x[j]) }));
const now = states[states.length - 1];
const near = analogs(states, now, 8, 12);
console.log(`\n3. The months most like ${now.date} (${names.map((n, j) => `${n} ${Number.isFinite(now.x[j]) ? now.x[j].toFixed(2) : "?"}`).join(", ")}):`);
const fwd = (date: string, n: number) => { const i = mi(date); return i >= 0 && i + n < market.length ? Math.log(market[i + n].close / market[i].close) : NaN; };
for (const a of near) {
  const s = states.find((x) => x.date === a.date)!;
  const secs = panel.rows.filter((r) => r[0] === a.date && r[2] && r[6] != null);
  const bySec = new Map<string, number[]>();
  for (const r of secs) (bySec.get(r[2]) ?? bySec.set(r[2], []).get(r[2])!).push(r[6]!);
  const ranked = [...bySec].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((x, y) => x + y, 0) / v.length] as [string, number]).sort((p, q) => q[1] - p[1]);
  console.log(`   ${a.date} (distance ${a.distance.toFixed(2)}): policy ${s.x[0]}%, CPI ${Number.isFinite(s.x[2]) ? s.x[2].toFixed(1) : "?"}%; market next 3m ${pct(fwd(a.date, 63))}, 6m ${pct(fwd(a.date, 126))}, 12m ${pct(fwd(a.date, 252))}; best ${ranked.slice(0, 3).map(([k, v]) => `${displaySector(k)} ${pct(v)}`).join(", ")}; worst ${ranked.slice(-2).map(([k, v]) => `${displaySector(k)} ${pct(v)}`).join(", ")}`);
}

const out = argOf("out");
if (out) writeFileSync(out, JSON.stringify({ factors: FACT, sensitivities: sens, timing: { ridge: ridge.rec, analogs: analogSignal.rec, trend: trend.rec, always: always.rec }, now, analogs: near }, null, 1));
