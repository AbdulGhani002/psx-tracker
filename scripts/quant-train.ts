// Train the market model and write down what it is worth.
//
//   npx tsx scripts/quant-train.ts [--dry] [--horizon 20] [--seeds 3] [--step 60] [--minTrain 500]
//        [--learner both|mlp|gbm] [--hidden 32,16] [--l2 1e-4] [--lr 5e-3] [--epochs 80] [--batch 64] [--patience 8]
//        [--rounds 300] [--depth 4] [--minLeaf 100] [--gbmLr 0.05]
//        [--no-context] [--macro] [--universe kse100|held] [--symbols A,B] [--held A,B]
//        [--no-validate] [--windows N] [--cache DIR] [--out FILE] [--fixedRounds] [--no-median]
//        [--archive DIR] [--top 120] [--finalSeeds 3] [--no-outlook]
//
// --archive trains on the exchange's 24-year archive (scripts/psx-history.ts)
// exactly as scripts/quant-long.ts tests it: a universe that changes each
// year, an equal-weight index, market breadth from every listed name. The
// walk-forward then IS the 24-year record, the rule test rides along, and
// the shipped model is the tested one. --finalSeeds sets the ensemble size
// for the final model separately from the walk-forward's.
//
// With --dry it uses a disk cache and touches no database; --out writes the
// trained ensemble with its walk-forward record as JSON, which
// scripts/quant-push.sh ships to the server and jobs/quant-import.js puts
// under quant:model, where the daily report reads it. Without --dry it does
// the same against Mongo directly (the held symbols come from the database).
//
// Training is minutes of synchronous arithmetic and runs on Abdul's machine,
// never inside the web server.

import { join } from "node:path";
import { writeFileSync, statSync } from "node:fs";
import { buildPanel, walkForwardPanel, trainFinal, predictEnsemble, type PanelWalkResult } from "../lib/quant/panel";
import { buildFeatures, readTrend, FEATURE_NAMES, TARGET_NAMES, DIP_PCT, RANK_FEATURE_NAMES } from "../lib/quant/features";
import { marketContext, macroContext, mergeContext } from "../lib/quant/context";
import { gbmFeatureUse } from "../lib/quant/gbm";
import { kse100Symbols, loadBars, TRAIN_INDICES } from "../lib/quant/universe";
import { loadMacro } from "../lib/timeseries/macro";
import { diskBarsCache, mongoBarsCache, saveQuantModel, type StoredQuantModel, type StoredIndexOutlook } from "../lib/quant/store";
import { loadLongIndex } from "../lib/quant/index-history";
import { indexStates, fitCells, evaluateCells, cellOutlook } from "../lib/quant/outlook";
import { buildArchivePanel } from "../lib/quant/archive";
import { strategyBacktest, strategyTable, strategyYearTable, type StrategyResult } from "../lib/quant/strategy";
import { MARKET_CONTEXT_NAMES } from "../lib/quant/context";
import type { EodBar } from "../lib/timeseries/psx-eod";
import { has, argOf, num, printResult, optionsFromArgs } from "./quant-cli";

const DRY = has("dry");
const DEFAULT_HELD = ["AHCL", "HINOON", "HUBC", "INDU", "LUCK", "MARI", "MEBL", "MUREB", "PPL", "PTL"];
const pad = (s: string, n: number) => s.padEnd(n);

async function heldSymbols(): Promise<string[]> {
  const given = argOf("held");
  if (given) return given.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (DRY) return DEFAULT_HELD;
  const { connectDb } = await import("../lib/db");
  const { HoldingModel } = await import("../lib/models/Holding");
  await connectDb();
  const syms: string[] = await HoldingModel.distinct("symbol", { currentShares: { $gt: 0 } });
  return syms.map((s) => s.toUpperCase()).sort();
}

async function main() {
  const t0 = Date.now();
  const opts = optionsFromArgs();
  const maxWindows = num("windows", 0);
  const useContext = !has("no-context");
  // The rupee, oil and global-risk block is opt-in: on five years of data it
  // cost direction skill (AUC 0.58 to 0.52 across three seeds) because five
  // years hold one rate cycle and one devaluation. Market breadth stays.
  const useMacro = useContext && has("macro");

  const held = await heldSymbols();
  const archiveDir = argOf("archive");
  const useRanks = has("ranks");

  let bars: Map<string, EodBar[]>;
  let index: EodBar[];
  let ctx: { context: Map<string, number[]>; names: string[] } | null = null;
  let panel: ReturnType<typeof buildPanel>;
  let featureNames: string[];
  let universeSource: string;
  let universeNames: string[];
  let breadth200: Map<string, number> | null = null;
  const trainedFrom: "eod" | "archive" = archiveDir ? "archive" : "eod";

  if (archiveDir) {
    if (useMacro) {
      console.error("--macro is not wired for --archive here; run scripts/quant-long.ts --macro to test it.");
      process.exit(1);
    }
    const arch = buildArchivePanel(archiveDir, opts.horizon, num("top", 120), useRanks, null);
    bars = arch.bars;
    index = arch.index;
    ctx = { context: arch.context, names: arch.contextNames };
    panel = arch.panel;
    featureNames = arch.featureNames;
    universeSource = `archive top ${num("top", 120)} by turnover, ${arch.years[0]} to ${arch.years[1]}`;
    universeNames = arch.universe;
    const brIdx = (MARKET_CONTEXT_NAMES as readonly string[]).indexOf("brAbove200");
    breadth200 = new Map();
    for (const [d, v] of arch.market) breadth200.set(d, v[brIdx] + 0.5);
    console.log(`Archive: ${bars.size} names, universe ${universeNames.length} names ever members, equal-weight index ${index[0].date} to ${index[index.length - 1].date}.`);
  } else {
    const universeMode = argOf("universe") ?? "kse100";
    let universe: string[] = [];
    universeSource = "held";
    if (universeMode === "kse100") {
      const u = await kse100Symbols();
      universe = u.symbols;
      universeSource = u.source;
    }
    const extra = (argOf("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const symbols = [...new Set([...TRAIN_INDICES, ...universe, ...held, ...extra])];

    const cacheDir = argOf("cache") || process.env.QUANT_CACHE || join(process.env.TEMP || process.env.TMP || ".", "psx-quant-cache");
    const cache = DRY ? diskBarsCache(cacheDir) : mongoBarsCache();
    console.log(`${DRY ? "DRY RUN. " : ""}Loading bars for ${symbols.length} symbols (universe ${universeMode}/${universeSource}, ${held.length} held)...`);
    bars = await loadBars(symbols, cache, 2, 250);
    const kse = bars.get("KSE100");
    if (!kse || kse.length < 400) {
      console.error("No KSE-100 history; cannot build features.");
      process.exit(1);
    }
    index = kse;
    console.log(`Loaded ${bars.size} series in ${((Date.now() - t0) / 1000).toFixed(0)}s. Index ${index[0].date} to ${index[index.length - 1].date}, ${index.length} sessions.`);

    // Market context comes from the stock names only, never the index rows.
    const stockBars = new Map([...bars].filter(([s]) => !TRAIN_INDICES.includes(s)));
    const dates = index.map((b) => b.date);
    if (useContext) {
      const market = marketContext(stockBars, index);
      let macro: Map<string, number[]> | null = null;
      if (useMacro) {
        const m = await loadMacro(cache);
        if (!m) {
          console.error("Macro series unavailable; refusing to train with a half-empty context. Drop --macro to train without it.");
          process.exit(1);
        }
        macro = macroContext(m, dates);
      }
      ctx = mergeContext(market, macro, dates);
      const brIdx = (MARKET_CONTEXT_NAMES as readonly string[]).indexOf("brAbove200");
      breadth200 = new Map();
      for (const [d, v] of market) breadth200.set(d, v[brIdx] + 0.5);
    }
    panel = buildPanel(bars, index, opts.horizon, { context: ctx?.context ?? null, ranks: useRanks });
    featureNames = [...FEATURE_NAMES, ...(ctx?.names ?? []), ...(useRanks ? RANK_FEATURE_NAMES : [])];
    universeNames = panel.symbols;
  }
  console.log(`Panel: ${panel.rows.length.toLocaleString()} rows, ${panel.symbols.length} names, ${panel.dates.length} sessions with features, ${featureNames.length} features (${ctx?.names.length ?? 0} context), targets ${TARGET_NAMES.join("/")} (dip = ${DIP_PCT}%).`);
  console.log(`Config: ${JSON.stringify({ horizon: opts.horizon, seeds: opts.seeds, step: opts.step, minTrain: opts.minTrain, threshold: opts.threshold, learner: opts.learner, mlp: opts.train, gbm: opts.gbm })}`);

  let validation: PanelWalkResult | null = null;
  if (!has("no-validate")) {
    let seen = 0;
    validation = walkForwardPanel(panel, opts, (w) => {
      seen++;
      console.log(`  window ${w.window}: trained on ${w.trainRows.toLocaleString()} rows, predicted ${w.testRows.toLocaleString()} (${w.from} to ${w.to}) in ${(w.ms / 1000).toFixed(1)}s${w.rounds ? `, rounds ${w.rounds.map((r) => r.toFixed(0)).join("/")}` : ""}`);
      if (maxWindows > 0 && seen >= maxWindows) throw new Error("__stop__");
    }, true);
  }
  if (validation) printResult(validation, held);
  let strategy: StrategyResult | null = null;
  if (validation?.points) {
    strategy = strategyBacktest(validation.points, index, breadth200, { horizon: opts.horizon, cashYieldPct: 10, costPct: 0.3 });
    if (strategy) console.log("\n" + strategyTable(strategy) + "\n\n" + strategyYearTable(strategy));
  }

  // The KSE-100 state table: what the index did after past days in each
  // state since 1997, tested walk-forward against the plain base rate.
  let indexOutlook: StoredIndexOutlook | null = null;
  if (!has("no-outlook")) {
    const cacheDir = argOf("cache") || process.env.QUANT_CACHE || join(process.env.TEMP || process.env.TMP || ".", "psx-quant-cache");
    const longIdx = await loadLongIndex(diskBarsCache(cacheDir, 24 * 7), bars.get("KSE100")).catch(() => null);
    if (!longIdx) console.log("\nKSE-100 long series unavailable (Yahoo ^KSE or the feed); the report will fall back to the model's odds for the index.");
    else {
      const states = indexStates(longIdx.bars, opts.horizon, breadth200);
      const { record, years: yearly } = evaluateCells(states, { horizon: opts.horizon, level: 1, shrink: 20, fromYear: 2005 });
      const cellModel = fitCells(states, opts.horizon, 20);
      indexOutlook = { model: cellModel, record, yearly, seriesFrom: longIdx.bars[0].date, seriesTo: longIdx.bars[longIdx.bars.length - 1].date, joinedAt: longIdx.joinedAt };
      const last = states[states.length - 1];
      const o = cellOutlook(cellModel, last, 1);
      console.log(`\nKSE-100 state table on ${longIdx.bars.length} sessions ${longIdx.bars[0].date} to ${longIdx.bars[longIdx.bars.length - 1].date} (joined at ${longIdx.joinedAt}, ${longIdx.maxJoinDiffPct.toFixed(3)}% apart). Walk-forward ${record.from.slice(0, 4)} to ${record.to.slice(0, 4)}, ${record.n} periods: Brier ${record.brier.toFixed(4)} vs base ${record.brierBase.toFixed(4)} (skill ${record.brierSkillPct >= 0 ? "+" : ""}${record.brierSkillPct.toFixed(1)}%), AUC ${record.auc.toFixed(3)}, dip skill ${record.dipSkillPct >= 0 ? "+" : ""}${record.dipSkillPct.toFixed(1)}%, 80% band covered ${(record.cover80 * 100).toFixed(0)}%.`);
      console.log(`Today (${last.date}): ${o.label}, ${Math.round(o.periods)} periods; up ${(o.pUp * 100).toFixed(0)}% (base ${(o.base.pUp * 100).toFixed(0)}%), median ${o.medianPct >= 0 ? "+" : ""}${o.medianPct.toFixed(1)}%, dip ${(o.pDip * 100).toFixed(0)}%, levels ${o.levels.map((l) => l.toFixed(0)).join(" / ")}.`);
    }
  }

  // The final boosters take the median round count the windows kept, so one
  // recent slice cannot shrink the shipped model to a stump when the market
  // has just changed character. --no-median keeps per-slice early stopping.
  const finalRounds = !has("no-median") && validation?.medianRounds ? validation.medianRounds : null;
  console.log(`\nTraining the final ensemble on every row with a known outcome${finalRounds ? ` (boosters fixed at ${finalRounds.join("/")} rounds, the medians the windows kept)` : ""}...`);
  const t1 = Date.now();
  const finalOpts = { ...opts, seeds: num("finalSeeds", opts.seeds) };
  const final = trainFinal(panel, finalOpts, finalRounds ?? undefined);
  const desc = final.learners.map((l) => (l.kind === "mlp" ? `mlp ${l.model.epochs}ep val ${l.model.valLoss.toFixed(4)}` : `gbm ${l.models.map((m) => m.rounds).join("/")} rounds`)).join("; ");
  console.log(`Trained ${final.learners.length} learner(s) on ${final.rows.toLocaleString()} rows to ${final.trainedTo} in ${((Date.now() - t1) / 1000).toFixed(0)}s: ${desc}.`);
  const gbms = final.learners.filter((l) => l.kind === "gbm").flatMap((l) => (l.kind === "gbm" ? l.models : []));
  if (gbms.length) {
    const use = gbmFeatureUse(gbms);
    const top = use.map((v, i) => ({ name: featureNames[i] ?? `f${i}`, v })).sort((a, b) => b.v - a.v).slice(0, 12);
    console.log(`What the trees split on most: ${top.map((t) => `${t.name} ${(t.v * 100).toFixed(1)}%`).join(", ")}.`);
  }

  console.log(`\nLatest forecasts, ${opts.horizon} sessions ahead (${TARGET_NAMES.join(" / ")}):`);
  // The latest rows come out of the panel itself, so the ranks (if any) are
  // the same ones the model was trained on.
  const lastRows = new Map<string, (typeof panel.rows)[number]>();
  for (const r of panel.rows) lastRows.set(r.symbol, r);
  for (const sym of [...TRAIN_INDICES, ...held]) {
    const last = lastRows.get(sym);
    if (!last) continue;
    const p = predictEnsemble(final.learners, last.x);
    const trend = readTrend(bars.get(sym) ?? []);
    console.log(`  ${pad(sym, 8)} up ${(p[0] * 100).toFixed(0).padStart(3)}%   beat ${(p[1] * 100).toFixed(0).padStart(3)}%   dip ${(p[2] * 100).toFixed(0).padStart(3)}%   ${trend?.label ?? "-"}   as of ${last.date}`);
  }

  const { points: _drop, ...validationNoPoints } = (validation ?? ({} as PanelWalkResult)) as PanelWalkResult;
  const stored: StoredQuantModel = {
    version: 2,
    trainedOn: new Date().toISOString(),
    trainedTo: final.trainedTo,
    horizon: opts.horizon,
    dipPct: DIP_PCT,
    featureNames,
    contextNames: ctx?.names ?? [],
    rankNames: useRanks ? [...RANK_FEATURE_NAMES] : [],
    targetNames: [...TARGET_NAMES],
    universe: universeNames,
    universeSource,
    trainedFrom,
    indexKind: archiveDir ? "equal-weight" : "kse100",
    strategy,
    rows: final.rows,
    config: finalOpts,
    finalRounds,
    indexOutlook,
    learners: final.learners,
    validation: validation ? validationNoPoints : null,
    runtimeSec: Math.round((Date.now() - t0) / 1000),
  };
  const outFile = argOf("out");
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(stored));
    console.log(`\nWrote ${outFile} (${(statSync(outFile).size / 1024).toFixed(0)} KiB). Push it with scripts/quant-push.sh, or jobs/quant-import.js on the server.`);
  }
  if (!DRY) {
    await saveQuantModel(stored);
    console.log(`\nSaved quant:model (${JSON.stringify(stored).length.toLocaleString()} bytes).`);
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s total`);
  process.exit(0);
}

main().catch((e) => {
  if (String(e?.message) === "__stop__") {
    console.log("(stopped after the requested number of windows)");
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});
