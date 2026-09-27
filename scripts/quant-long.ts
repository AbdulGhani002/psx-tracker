// The long test: walk the model forward through every year the exchange has
// published, 2002 to today, on a universe that changes with the market.
//
//   npx tsx scripts/quant-long.ts --history DIR [--horizon 20] [--step 250] [--minTrain 750] [--top 120]
//        [--learner both|mlp|gbm] [--seeds 1] [--macro] [--cache DIR] [--save] [--out FILE]
//
// DIR is what scripts/psx-history.ts wrote. Each calendar year's universe is
// the `top` names by median daily traded value over the PREVIOUS year, so a
// name enters only on what was known before it entered, and names that were
// later delisted stay in for the years they were liquid. That is the part the
// live five-year feed cannot give you: a test with no survivorship bias.
//
// The market index for the features is the equal-weight index of the current
// universe, chained from daily mean log returns, because the PSX does not
// publish the KSE-100 back that far in any free feed. The market-breadth
// context comes from every listed name with enough history.
//
// With --save the summary (never the points) is written to the feed store
// under quant:validation:long so the daily report can cite it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPanel, walkForwardPanel, rankScore, type PanelOptions, type PanelPoint, auc, spearman } from "../lib/quant/panel";
import { buildArchivePanel } from "../lib/quant/archive";
import { macroContext, MARKET_CONTEXT_NAMES } from "../lib/quant/context";
import { strategyBacktest, strategyTable, strategyYearTable } from "../lib/quant/strategy";
import { loadMacro } from "../lib/timeseries/macro";
import { diskBarsCache } from "../lib/quant/store";
import type { EodBar } from "../lib/timeseries/psx-eod";
import { has, argOf, num, printResult, optionsFromArgs } from "./quant-cli";

const HIST = argOf("history") || join(process.env.TEMP || ".", "psx-history");
const TOP = num("top", 120);

function byYear(points: PanelPoint[], horizon: number) {
  const groups = new Map<string, PanelPoint[]>();
  for (const q of points) {
    const y = q.date.slice(0, 4);
    const g = groups.get(y);
    if (g) g.push(q); else groups.set(y, [q]);
  }
  const rows: Array<{ year: string; n: number; aucUp: number; aucBeat: number; aucDip: number; icRel: number; mktPct: number; upBase: number }> = [];
  for (const [year, g] of [...groups].sort()) {
    const dates = new Map<number, PanelPoint[]>();
    for (const q of g) { const a = dates.get(q.di); if (a) a.push(q); else dates.set(q.di, [q]); }
    const ics: number[] = [];
    for (const [, dg] of dates) if (dg.length >= 8) ics.push(spearman(dg.map((q) => rankScore(q.p)), dg.map((q) => q.fwdRel)));
    // Market return that year, from the names themselves, non-overlapping.
    let mkt = 0, cnt = 0;
    const sortedDi = [...dates.keys()].sort((a, b) => a - b);
    for (let i = 0; i < sortedDi.length; i += horizon) {
      const dg = dates.get(sortedDi[i])!;
      mkt += dg.reduce((s, q) => s + q.fwdRet, 0) / dg.length;
      cnt++;
    }
    rows.push({
      year, n: g.length,
      aucUp: auc(g.map((q) => ({ p: q.p[0], y: q.t[0] }))),
      aucBeat: auc(g.map((q) => ({ p: q.p[1], y: q.t[1] }))),
      aucDip: auc(g.map((q) => ({ p: q.p[2], y: q.t[2] }))),
      icRel: ics.length ? ics.reduce((s, v) => s + v, 0) / ics.length : 0,
      mktPct: cnt ? (Math.exp(mkt) - 1) * 100 : 0,
      upBase: g.filter((q) => q.t[0] === 1).length / g.length,
    });
  }
  return rows;
}

async function main() {
  const t0 = Date.now();
  const opts: PanelOptions = { ...optionsFromArgs(), step: num("step", 250), minTrain: num("minTrain", 750) };
  let macro: Map<string, number[]> | null = null;
  const useRanks = has("ranks");
  if (has("macro")) {
    const cacheDir = argOf("cache") || process.env.QUANT_CACHE || join(process.env.TEMP || ".", "psx-quant-cache");
    const m = await loadMacro(diskBarsCache(cacheDir, 24 * 7));
    if (!m) { console.error("Macro series unavailable; drop --macro to run without them."); process.exit(1); }
    // The macro context needs the archive's dates; build once without it to get them.
    const probe = buildArchivePanel(HIST, opts.horizon, TOP, false, null, { extras: !has("no-extras"), xs: !!opts.xs });
    macro = macroContext(m, probe.index.map((b) => b.date));
  }
  const arch = buildArchivePanel(HIST, opts.horizon, TOP, useRanks, macro, { extras: !has("no-extras"), xs: !!opts.xs });
  const { panel, index, market, featureNames } = arch;
  const years = arch.years;
  console.log(`History: ${arch.bars.size} names with 250+ bars. Universe: top ${TOP} by traded value, ${years[0]} to ${years[1]}, ${arch.universe.length} names ever members.`);
  console.log(`Equal-weight index: ${index.length} sessions, ${index[0].date} to ${index[index.length - 1].date}, level ${index[index.length - 1].close.toFixed(0)}.`);
  console.log(`Panel: ${panel.rows.length.toLocaleString()} rows, ${panel.symbols.length} names, ${panel.dates.length} sessions, ${featureNames.length} features. Built in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
  console.log(`Config: ${JSON.stringify({ horizon: opts.horizon, seeds: opts.seeds, step: opts.step, minTrain: opts.minTrain, learner: opts.learner, mlp: opts.train, gbm: opts.gbm })}`);

  const result = walkForwardPanel(panel, opts, (w) => {
    console.log(`  window ${w.window}: trained on ${w.trainRows.toLocaleString()} rows, predicted ${w.testRows.toLocaleString()} (${w.from} to ${w.to}) in ${(w.ms / 1000).toFixed(0)}s`);
  }, true);
  if (!result) { console.error("No result."); process.exit(1); }
  printResult(result, []);

  const yearly = byYear(result.points!, opts.horizon);
  console.log("\nYear by year (the market column is the equal-weight universe, non-overlapping windows):");
  console.log("year    n       up base  AUC up  AUC beat  AUC dip   IC rel   market");
  for (const y of yearly) {
    console.log(`${y.year}  ${String(y.n).padStart(6)}   ${(y.upBase * 100).toFixed(0).padStart(5)}%   ${y.aucUp.toFixed(3)}   ${y.aucBeat.toFixed(3)}     ${y.aucDip.toFixed(3)}   ${(y.icRel >= 0 ? "+" : "") + y.icRel.toFixed(3)}   ${(y.mktPct >= 0 ? "+" : "") + y.mktPct.toFixed(0)}%`);
  }
  const bear = yearly.filter((y) => y.mktPct < 0), bull = yearly.filter((y) => y.mktPct >= 0);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  console.log(`\nDown years (${bear.map((y) => y.year).join(", ")}): mean AUC up ${mean(bear.map((y) => y.aucUp)).toFixed(3)}, AUC dip ${mean(bear.map((y) => y.aucDip)).toFixed(3)}, IC rel ${mean(bear.map((y) => y.icRel)).toFixed(3)}.`);
  console.log(`Up years   (${bull.length}): mean AUC up ${mean(bull.map((y) => y.aucUp)).toFixed(3)}, AUC dip ${mean(bull.map((y) => y.aucDip)).toFixed(3)}, IC rel ${mean(bull.map((y) => y.icRel)).toFixed(3)}.`);

  // The rule, as a rule: hold the model's top fifth, gated by the index and
  // by breadth, against the universe held outright.
  const brIdx = (MARKET_CONTEXT_NAMES as readonly string[]).indexOf("brAbove200");
  const breadth200 = new Map<string, number>();
  for (const [d, v] of market) breadth200.set(d, v[brIdx] + 0.5);
  const strategy = strategyBacktest(result.points!, index, breadth200, { horizon: opts.horizon, cashYieldPct: 10, costPct: 0.3 });
  if (strategy) {
    console.log("\n" + strategyTable(strategy));
    console.log("\n" + strategyYearTable(strategy));
  }

  const { points: _p, ...summary } = result;
  const doc = { ranOn: new Date().toISOString(), universeTop: TOP, years: `${years[0]}-${years[1]}`, names: panel.symbols.length, rows: panel.rows.length, featureNames, config: opts, summary, yearly, strategy, runtimeSec: Math.round((Date.now() - t0) / 1000) };
  const outFile = argOf("out");
  if (outFile) { writeFileSync(outFile, JSON.stringify(doc)); console.log(`Wrote ${outFile}`); }
  if (has("save")) {
    const { saveQuantSnapshot } = await import("../lib/quant/store");
    await saveQuantSnapshot("quant:validation:long", doc, `${years[0]}-${years[1]}, ${panel.rows.length} rows`);
    console.log("Saved quant:validation:long");
  }
  console.log(`\n${((Date.now() - t0) / 60000).toFixed(1)} min total`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
