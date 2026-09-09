// Train the market model and write down what it is worth.
//
//   npx tsx scripts/quant-train.ts [--dry] [--horizon 20] [--seeds 3] [--step 60] [--minTrain 500]
//        [--learner both|mlp|gbm] [--hidden 32,16] [--l2 1e-4] [--lr 5e-3] [--epochs 80] [--batch 64] [--patience 8]
//        [--rounds 300] [--depth 4] [--minLeaf 100] [--gbmLr 0.05]
//        [--no-context] [--no-macro] [--universe kse100|held] [--symbols A,B] [--held A,B]
//        [--no-validate] [--windows N] [--cache DIR]
//
// Without --dry it connects to Mongo, reads the held symbols, caches bars in
// the feed store and saves the trained ensemble with its walk-forward record
// under quant:model, where the daily report reads it. With --dry it uses a
// disk cache and writes nothing, which is how the experiments were run.
//
// On the server this file is bundled with esbuild and run by a systemd timer
// as its own process, because training is synchronous arithmetic and must
// never run inside the web server.

import { join } from "node:path";
import { buildPanel, walkForwardPanel, trainFinal, predictEnsemble, type PanelWalkResult } from "../lib/quant/panel";
import { buildFeatures, readTrend, FEATURE_NAMES, TARGET_NAMES, DIP_PCT } from "../lib/quant/features";
import { marketContext, macroContext, mergeContext } from "../lib/quant/context";
import { gbmFeatureUse } from "../lib/quant/gbm";
import { kse100Symbols, loadBars, TRAIN_INDICES } from "../lib/quant/universe";
import { loadMacro } from "../lib/timeseries/macro";
import { diskBarsCache, mongoBarsCache, saveQuantModel, type StoredQuantModel } from "../lib/quant/store";

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
  const useMacro = useContext && !has("no-macro");

  const held = await heldSymbols();
  const universeMode = argOf("universe") ?? "kse100";
  let universe: string[] = [];
  let universeSource = "held";
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
  const bars = await loadBars(symbols, cache, 4);
  const index = bars.get("KSE100");
  if (!index || index.length < 400) {
    console.error("No KSE-100 history; cannot build features.");
    process.exit(1);
  }
  console.log(`Loaded ${bars.size} series in ${((Date.now() - t0) / 1000).toFixed(0)}s. Index ${index[0].date} to ${index[index.length - 1].date}, ${index.length} sessions.`);

  // Market context comes from the stock names only, never the index rows.
  const stockBars = new Map([...bars].filter(([s]) => !TRAIN_INDICES.includes(s)));
  const dates = index.map((b) => b.date);
  let ctx: { context: Map<string, number[]>; names: string[] } | null = null;
  if (useContext) {
    const market = marketContext(stockBars, index);
    let macro: Map<string, number[]> | null = null;
    if (useMacro) {
      const m = await loadMacro(cache);
      if (!m) {
        console.error("Macro series unavailable; refusing to train with a half-empty context. Use --no-macro to train without it.");
        process.exit(1);
      }
      macro = macroContext(m, dates);
    }
    ctx = mergeContext(market, macro, dates);
  }

  const panel = buildPanel(bars, index, opts.horizon, { context: ctx?.context ?? null });
  const featureNames = [...FEATURE_NAMES, ...(ctx?.names ?? [])];
  console.log(`Panel: ${panel.rows.length.toLocaleString()} rows, ${panel.symbols.length} names, ${panel.dates.length} sessions with features, ${featureNames.length} features (${ctx?.names.length ?? 0} context), targets ${TARGET_NAMES.join("/")} (dip = ${DIP_PCT}%).`);
  console.log(`Config: ${JSON.stringify({ horizon: opts.horizon, seeds: opts.seeds, step: opts.step, minTrain: opts.minTrain, threshold: opts.threshold, learner: opts.learner, mlp: opts.train, gbm: opts.gbm })}`);

  let validation: PanelWalkResult | null = null;
  if (!has("no-validate")) {
    let seen = 0;
    validation = walkForwardPanel(panel, opts, (w) => {
      seen++;
      console.log(`  window ${w.window}: trained on ${w.trainRows.toLocaleString()} rows, predicted ${w.testRows.toLocaleString()} (${w.from} to ${w.to}) in ${(w.ms / 1000).toFixed(1)}s`);
      if (maxWindows > 0 && seen >= maxWindows) throw new Error("__stop__");
    });
  }
  if (validation) printResult(validation, held);

  console.log("\nTraining the final ensemble on every row with a known outcome...");
  const t1 = Date.now();
  const final = trainFinal(panel, opts);
  const desc = final.learners.map((l) => (l.kind === "mlp" ? `mlp ${l.model.epochs}ep val ${l.model.valLoss.toFixed(4)}` : `gbm ${l.models.map((m) => m.rounds).join("/")} rounds`)).join("; ");
  console.log(`Trained ${final.learners.length} learner(s) on ${final.rows.toLocaleString()} rows to ${final.trainedTo} in ${((Date.now() - t1) / 1000).toFixed(0)}s: ${desc}.`);
  const gbms = final.learners.filter((l) => l.kind === "gbm").flatMap((l) => (l.kind === "gbm" ? l.models : []));
  if (gbms.length) {
    const use = gbmFeatureUse(gbms);
    const top = use.map((v, i) => ({ name: featureNames[i] ?? `f${i}`, v })).sort((a, b) => b.v - a.v).slice(0, 12);
    console.log(`What the trees split on most: ${top.map((t) => `${t.name} ${(t.v * 100).toFixed(1)}%`).join(", ")}.`);
  }

  console.log(`\nLatest forecasts, ${opts.horizon} sessions ahead (${TARGET_NAMES.join(" / ")}):`);
  for (const sym of [...TRAIN_INDICES, ...held]) {
    const b = bars.get(sym);
    if (!b) continue;
    const rows = buildFeatures(b, index, opts.horizon, ctx?.context ?? null);
    const last = rows[rows.length - 1];
    if (!last) continue;
    const p = predictEnsemble(final.learners, last.x);
    const trend = readTrend(b);
    console.log(`  ${pad(sym, 8)} up ${(p[0] * 100).toFixed(0).padStart(3)}%   beat ${(p[1] * 100).toFixed(0).padStart(3)}%   dip ${(p[2] * 100).toFixed(0).padStart(3)}%   ${trend?.label ?? "-"}   as of ${last.date}`);
  }

  if (!DRY) {
    const { points: _drop, ...validationNoPoints } = (validation ?? ({} as PanelWalkResult)) as PanelWalkResult;
    const stored: StoredQuantModel = {
      version: 2,
      trainedOn: new Date().toISOString(),
      trainedTo: final.trainedTo,
      horizon: opts.horizon,
      dipPct: DIP_PCT,
      featureNames,
      contextNames: ctx?.names ?? [],
      targetNames: [...TARGET_NAMES],
      universe: panel.symbols,
      universeSource,
      rows: final.rows,
      config: opts,
      learners: final.learners,
      validation: validation ? validationNoPoints : null,
      runtimeSec: Math.round((Date.now() - t0) / 1000),
    };
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
