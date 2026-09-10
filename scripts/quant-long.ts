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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPanel, walkForwardPanel, type PanelOptions, type PanelPoint, auc, spearman } from "../lib/quant/panel";
import { FEATURE_NAMES } from "../lib/quant/features";
import { marketContext, macroContext, mergeContext } from "../lib/quant/context";
import { loadMacro } from "../lib/timeseries/macro";
import { diskBarsCache } from "../lib/quant/store";
import type { EodBar } from "../lib/timeseries/psx-eod";
import { has, argOf, num, printResult, optionsFromArgs } from "./quant-cli";

const HIST = argOf("history") || join(process.env.TEMP || ".", "psx-history");
const TOP = num("top", 120);
const iso = (n: number) => String(n).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");

function loadHistory(): Map<string, EodBar[]> {
  const idx = JSON.parse(readFileSync(join(HIST, "index.json"), "utf8")) as { index: Array<{ symbol: string; bars: number }> };
  const out = new Map<string, EodBar[]>();
  for (const e of idx.index) {
    const f = join(HIST, "symbols", e.symbol + ".json");
    if (!existsSync(f)) continue;
    const raw = JSON.parse(readFileSync(f, "utf8")) as number[][];
    const bars: EodBar[] = [];
    for (const [d, o, h, l, c, v] of raw) {
      if (!(c > 0)) continue;
      // Close against the day's typical price stands in for close against
      // VWAP, which this archive does not carry.
      const typical = h > 0 && l > 0 ? (h + l + c) / 3 : c;
      bars.push({ date: iso(d), close: c, volume: v > 0 ? v : 0, vwap: typical });
    }
    if (bars.length >= 250) out.set(e.symbol, bars);
  }
  return out;
}

// Per calendar year, the `top` names by median traded value in the previous year.
function membership(bars: Map<string, EodBar[]>, top: number): Map<number, Set<string>> {
  const byYear = new Map<number, Map<string, number[]>>();
  for (const [s, b] of bars) {
    for (const bar of b) {
      const y = Number(bar.date.slice(0, 4));
      let m = byYear.get(y);
      if (!m) byYear.set(y, (m = new Map()));
      let arr = m.get(s);
      if (!arr) m.set(s, (arr = []));
      arr.push(bar.close * bar.volume);
    }
  }
  const out = new Map<number, Set<string>>();
  for (const [y, m] of byYear) {
    const ranked = [...m]
      .filter(([, v]) => v.length >= 200)
      .map(([s, v]) => {
        const sorted = [...v].sort((a, b) => a - b);
        return { s, med: sorted[Math.floor(sorted.length / 2)] };
      })
      .filter((r) => r.med > 0)
      .sort((a, b) => b.med - a.med)
      .slice(0, top)
      .map((r) => r.s);
    out.set(y + 1, new Set(ranked));
  }
  return out;
}

// Equal-weight index of the current members, chained from mean daily log returns.
function equalWeightIndex(bars: Map<string, EodBar[]>, members: Map<number, Set<string>>): EodBar[] {
  const acc = new Map<string, { s: number; n: number }>();
  for (const [sym, b] of bars) {
    for (let i = 1; i < b.length; i++) {
      const y = Number(b[i].date.slice(0, 4));
      if (!members.get(y)?.has(sym)) continue;
      const r = Math.max(-0.3, Math.min(0.3, Math.log(b[i].close / b[i - 1].close)));
      const a = acc.get(b[i].date);
      if (a) { a.s += r; a.n++; } else acc.set(b[i].date, { s: r, n: 1 });
    }
  }
  const dates = [...acc.keys()].sort();
  const out: EodBar[] = [];
  let level = Math.log(100);
  for (const d of dates) {
    const a = acc.get(d)!;
    if (a.n < 10) continue;
    level += a.s / a.n;
    out.push({ date: d, close: Math.exp(level), volume: 0, vwap: Math.exp(level) });
  }
  return out;
}

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
    for (const [, dg] of dates) if (dg.length >= 8) ics.push(spearman(dg.map((q) => q.p[1]), dg.map((q) => q.fwdRel)));
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
  const bars = loadHistory();
  const members = membership(bars, TOP);
  const memberSymbols = new Set<string>();
  for (const [, s] of members) for (const x of s) memberSymbols.add(x);
  const years = [...members.keys()].sort();
  console.log(`History: ${bars.size} names with 250+ bars. Universe: top ${TOP} by traded value, ${years[0]} to ${years[years.length - 1]}, ${memberSymbols.size} names ever members.`);

  const index = equalWeightIndex(bars, members);
  console.log(`Equal-weight index: ${index.length} sessions, ${index[0].date} to ${index[index.length - 1].date}, level ${index[index.length - 1].close.toFixed(0)}.`);

  const dates = index.map((b) => b.date);
  const market = marketContext(bars, index);
  let macro: Map<string, number[]> | null = null;
  if (has("macro")) {
    const cacheDir = argOf("cache") || process.env.QUANT_CACHE || join(process.env.TEMP || ".", "psx-quant-cache");
    const m = await loadMacro(diskBarsCache(cacheDir, 24 * 7));
    if (!m) { console.error("Macro series unavailable; drop --macro to run without them."); process.exit(1); }
    macro = macroContext(m, dates);
  }
  const ctx = mergeContext(market, macro, dates)!;

  const memberBars = new Map([...bars].filter(([s]) => memberSymbols.has(s)));
  const include = (symbol: string, date: string) => members.get(Number(date.slice(0, 4)))?.has(symbol) ?? false;
  const panel = buildPanel(memberBars, index, opts.horizon, { context: ctx.context, include, minRows: 60 });
  const featureNames = [...FEATURE_NAMES, ...ctx.names];
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

  const { points: _p, ...summary } = result;
  const doc = { ranOn: new Date().toISOString(), universeTop: TOP, years: `${years[0]}-${years[years.length - 1]}`, names: panel.symbols.length, rows: panel.rows.length, featureNames, config: opts, summary, yearly, runtimeSec: Math.round((Date.now() - t0) / 1000) };
  const outFile = argOf("out");
  if (outFile) { writeFileSync(outFile, JSON.stringify(doc)); console.log(`Wrote ${outFile}`); }
  if (has("save")) {
    const { saveQuantSnapshot } = await import("../lib/quant/store");
    await saveQuantSnapshot("quant:validation:long", doc, `${years[0]}-${years[years.length - 1]}, ${panel.rows.length} rows`);
    console.log("Saved quant:validation:long");
  }
  console.log(`\n${((Date.now() - t0) / 60000).toFixed(1)} min total`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
