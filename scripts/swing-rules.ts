// Re-test swing rules on saved out-of-sample predictions, without retraining.
//
//   npx tsx scripts/swing-rules.ts --points FILE [--archive DIR] [--top 120] [--horizon 20] [--walk] [--patch MODEL.json]
//   npx tsx scripts/swing-rules.ts --points FILE --grid [--step 5]
//   npx tsx scripts/swing-rules.ts --points FILE --book [--grid2] [--out TESTED.json]
//
// FILE is what scripts/quant-train.ts --points wrote: the walk-forward's
// predictions for every name and date. The bars and the equal-weight index are
// rebuilt from the archive exactly as the training run built them, so the
// levels, the market gate and the fills are the ones the run would have used.
// --walk reads the zones off the plain walk (what the site shows when the
// model's path curve did not beat it). --patch writes the results into a model
// file's `swing` field before it is imported. --grid tries stops in units of
// each name's own volatility, targets as multiples of the risk and holding
// caps, and prints them best first with each half of the sample on its own.

import { readFileSync, writeFileSync } from "node:fs";
import { loadArchive, membership, equalWeightIndex } from "../lib/quant/archive";
import { indexGate } from "../lib/quant/strategy";
import { swingBacktest, swingTable, swingBookBacktest, DEFAULT_SWING_RULES, SWING_BOOK_RULE, type SwingRule, type SwingStats, type BookRule, type BookStats, type SwingTested } from "../lib/quant/swing";
import type { PanelPoint } from "../lib/quant/panel";
import { argOf, has, num } from "./quant-cli";

const file = argOf("points");
if (!file) {
  console.error("--points FILE is required");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(file, "utf8")) as Array<[string, string, number, Array<number | null>, number | null, number | null]>;
const points: PanelPoint[] = raw.map(([symbol, date, di, p, fwdRet, fwdRel]) => ({ symbol, date, di, p: p.map((v) => (v == null ? NaN : v)), t: [], fwdRet: fwdRet ?? 0, fwdRel: fwdRel ?? 0 }));
const bars = loadArchive(argOf("archive") || "C:/CC/Data/psx-history");
const index = equalWeightIndex(bars, membership(bars, num("top", 120)));
const gate = indexGate(index);
const horizon = num("horizon", 20);

if (has("book")) {
  // The book as the page runs it, against variations of it, and the index.
  const variants: Array<[string, Partial<BookRule>]> = [
    ["the page's rule", {}],
    ["no cooldown", { cooldown: 0 }],
    ["5-session cooldown", { cooldown: 5 }],
    ["20-session cooldown", { cooldown: 20 }],
    ["3 slots", { slots: 3 }],
    ["8 slots", { slots: 8 }],
    ["stop 0.8, 2R", { stopSigma: 0.8 }],
    ["stop 1.25, 1.5R", { stopSigma: 1.25, targetR: 1.5 }],
    ["10-session sell-by", { maxHold: 10 }],
    ["20-session sell-by", { maxHold: 20 }],
    ["any market", { strongOnly: false }],
  ];
  const f1 = (v: number, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d);
  const head = "book".padEnd(30) + "trades".padStart(7) + "/yr".padStart(5) + "win".padStart(6) + "avg%".padStart(7) + "PF".padStart(6) + "tgt".padStart(5) + "stop".padStart(5) + "time".padStart(5) + "days".padStart(6) + "CAGR".padStart(7) + "maxDD".padStart(7) + "in%".padStart(5) + "  halves";
  console.log(head);
  const results: Array<[string, BookStats]> = [];
  const show = (label: string, r: BookStats) =>
    console.log(
      label.padEnd(30) + String(r.trades).padStart(7) + r.tradesPerYear.toFixed(0).padStart(5) + ((r.winRate * 100).toFixed(0) + "%").padStart(6) + f1(r.avgRetPct, 2).padStart(7) + r.profitFactor.toFixed(2).padStart(6) +
        ((r.hitTarget * 100).toFixed(0) + "%").padStart(5) + ((r.hitStop * 100).toFixed(0) + "%").padStart(5) + ((r.hitTime * 100).toFixed(0) + "%").padStart(5) + r.avgDays.toFixed(1).padStart(6) +
        (f1(r.cagrPct) + "%").padStart(7) + (r.maxDrawdownPct.toFixed(0) + "%").padStart(7) + r.exposurePct.toFixed(0).padStart(5) + `  ${f1(r.halves[0], 2)} / ${f1(r.halves[1], 2)}  CAGR ${f1(r.cagrHalves[0])}% / ${f1(r.cagrHalves[1])}%  win ${f1(r.avgWinPct)} loss ${f1(r.avgLossPct)}`
    );
  for (const [label, v] of variants) {
    const r = swingBookBacktest(points, bars, gate, { ...SWING_BOOK_RULE, ...v });
    results.push([label, r]);
    show(label, r);
  }
  // Without the model: the same book on random names, five draws.
  const draws: BookStats[] = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = swingBookBacktest(points, bars, gate, { ...SWING_BOOK_RULE, minPctile: 0 }, { shuffleSeed: seed });
    draws.push(r);
    show(`random names (seed ${seed})`, r);
  }
  if (has("grid2")) {
    console.log("\nSecond round: cooldown x stop/target x sell-by x slots\n" + head);
    const rows: Array<[string, BookStats]> = [];
    for (const cooldown of [0, 5, 10, 20])
      for (const [stopSigma, targetR] of [[1, 2], [0.8, 2.5], [1.25, 1.5], [0.8, 2], [1, 1.5]])
        for (const maxHold of [15, 20])
          for (const slots of [5, 8]) {
            const r = swingBookBacktest(points, bars, gate, { ...SWING_BOOK_RULE, cooldown, stopSigma, targetR, maxHold, slots });
            rows.push([`cd${cooldown} ${stopSigma}s ${targetR}R ${maxHold}d ${slots}sl`, r]);
          }
    const score = (r: BookStats) => Math.min(r.cagrHalves[0], r.cagrHalves[1]);
    for (const [label, r] of rows.sort((a, b) => score(b[1]) - score(a[1]))) show(label, r);
  }
  const first = results[0][1];
  const ia = index.findIndex((b) => b.date >= first.from);
  const ib = index.length - 1 - [...index].reverse().findIndex((b) => b.date <= first.to);
  let indexCagrPct: number | null = null;
  if (ia >= 0 && ib > ia) {
    const yrs = (Date.parse(index[ib].date) - Date.parse(index[ia].date)) / (365.25 * 86400000);
    let pk = 0, dd = 0;
    for (let k = ia; k <= ib; k++) { pk = Math.max(pk, index[k].close); dd = Math.min(dd, index[k].close / pk - 1); }
    indexCagrPct = (Math.pow(index[ib].close / index[ia].close, 1 / yrs) - 1) * 100;
    console.log(`\nThe equal-weight index over the same dates: ${f1(indexCagrPct)}% a year, max drawdown ${(dd * 100).toFixed(0)}%.`);
  }
  const mean = (f: (r: BookStats) => number) => draws.reduce((a, r) => a + f(r), 0) / draws.length;
  const tested: SwingTested = {
    stats: first,
    random: { cagrPct: mean((r) => r.cagrPct), winRate: mean((r) => r.winRate), avgRetPct: mean((r) => r.avgRetPct), maxDrawdownPct: mean((r) => r.maxDrawdownPct), draws: draws.length },
    indexCagrPct,
    builtAt: new Date().toISOString(),
  };
  const outFile = argOf("out");
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(tested));
    console.log(`\nWrote the page's record to ${outFile} (import it as quant:swing:tested).`);
  }
  console.log(`\nThe page's rule, year by year (${first.from} to ${first.to}):`);
  console.log(first.years.map((y) => `${y.year} ${f1(y.retPct)}% (${y.trades})`).join("  "));
  process.exit(0);
}

if (has("grid")) {
  const grid: SwingRule[] = [];
  const tag = (pc: number) => (pc >= 0.9 ? "top 10%" : pc >= 0.8 ? "top 20%" : "all");
  for (const pc of [0.8, 0.9])
    for (const stopSigma of [0.4, 0.6, 0.8, 1.0, 1.25])
      for (const targetR of [1, 1.5, 2, 2.5, 3])
        for (const maxHold of [10, 15, 20])
          grid.push({ name: `${tag(pc)} stop ${stopSigma}s ${targetR}R ${maxHold}d`, minPctile: pc, strongOnly: true, entry: "market", target: "t1", stopSigma, targetR, maxHold });
  const t0 = Date.now();
  const res = swingBacktest(points, bars, gate, horizon, grid, { walkLevels: true, stepDays: num("step", 5) });
  const perDay = (x: SwingStats) => (x.avgDays > 0 ? x.avgRetPct / x.avgDays : 0);
  const f2 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
  const head = "rule".padEnd(30) + "trades".padStart(7) + "win".padStart(6) + "tgt".padStart(6) + "stop".padStart(6) + "avg%".padStart(7) + "PF".padStart(6) + "days".padStart(6) + "%/day".padStart(7) + "1st half".padStart(9) + "2nd half".padStart(9) + "stop%".padStart(7);
  const row = (x: SwingStats) =>
    x.rule.padEnd(30) + String(x.trades).padStart(7) + ((x.winRate * 100).toFixed(0) + "%").padStart(6) + ((x.hitTarget * 100).toFixed(0) + "%").padStart(6) + ((x.hitStop * 100).toFixed(0) + "%").padStart(6) +
    f2(x.avgRetPct).padStart(7) + x.profitFactor.toFixed(2).padStart(6) + x.avgDays.toFixed(1).padStart(6) + f2(perDay(x)).padStart(7) + f2(x.halves?.[0] ?? 0).padStart(9) + f2(x.halves?.[1] ?? 0).padStart(9) + (x.stopPct ?? 0).toFixed(1).padStart(7);
  console.log(`${points.length.toLocaleString()} points, ${bars.size} names, ${grid.length} rules in ${((Date.now() - t0) / 1000).toFixed(0)}s. Strong market only, buy at the next close.\n`);
  console.log("By the average trade:\n" + head);
  for (const x of [...res].sort((a, b) => b.avgRetPct - a.avgRetPct).slice(0, 30)) console.log(row(x));
  console.log("\nBy return per day held (capital turns over):\n" + head);
  for (const x of [...res].sort((a, b) => perDay(b) - perDay(a)).slice(0, 30)) console.log(row(x));
  const good = res.filter((x) => (x.rr ?? 0) >= 1.5 && (x.halves?.[0] ?? 0) > 0 && (x.halves?.[1] ?? 0) > 0);
  console.log(`\nReward at least 1.5x the risk and positive in both halves: ${good.length} rules.\n` + head);
  for (const x of good.sort((a, b) => perDay(b) - perDay(a)).slice(0, 20)) console.log(row(x));
  // The same exits on every name: what is the model's part?
  const best = good.slice(0, 6);
  const base = swingBacktest(points, bars, gate, horizon, best.map((x) => ({ ...grid.find((g) => g.name === x.rule)!, name: x.rule.replace(/^top \d+%/, "all"), minPctile: 0 })), { walkLevels: true, stepDays: num("step", 5) });
  console.log("\nThe same exits on every name (no model):\n" + head);
  for (const x of base) console.log(row(x));
  process.exit(0);
}

const stats = swingBacktest(points, bars, gate, horizon, DEFAULT_SWING_RULES, { walkLevels: has("walk") });
console.log(`${points.length.toLocaleString()} points, ${bars.size} names, zones from ${has("walk") ? "the plain walk" : "the model's path curve"}.\n`);
console.log(swingTable(stats));
for (const s of stats) console.log(`  ${s.rule.slice(0, 60).padEnd(60)} strong market ${s.strong?.trades ?? 0} trades, win ${Math.round((s.strong?.winRate ?? 0) * 100)}%, avg ${(s.strong?.avgRetPct ?? 0).toFixed(2)}%   weak ${s.weak?.trades ?? 0}, win ${Math.round((s.weak?.winRate ?? 0) * 100)}%, avg ${(s.weak?.avgRetPct ?? 0).toFixed(2)}%`);
const patch = argOf("patch");
if (patch) {
  const model = JSON.parse(readFileSync(patch, "utf8"));
  model.swing = stats;
  writeFileSync(patch, JSON.stringify(model));
  console.log(`\nWrote the ${stats.length} rules into ${patch}.`);
}
