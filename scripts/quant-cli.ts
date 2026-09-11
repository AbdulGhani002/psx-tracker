// Shared by scripts/quant-train.ts and scripts/quant-long.ts: the printed
// table and the command-line options. No side effects here, so importing it
// never starts a run.

import { describeAuc, DEFAULT_PANEL, type PanelOptions, type PanelWalkResult } from "../lib/quant/panel";
import { TRAIN_INDICES } from "../lib/quant/universe";

export const has = (n: string) => process.argv.includes("--" + n);
export const argOf = (n: string) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
export const num = (n: string, d: number) => {
  const v = argOf(n);
  return v == null ? d : Number(v);
};

const pct = (v: number, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

export function printResult(v: PanelWalkResult, held: string[]) {
  console.log(`\nOut of sample: ${v.n.toLocaleString()} name-days over ${v.windows} windows, ${v.from} to ${v.to}, ${v.symbols} names, horizon ${v.horizon} sessions.\n`);
  const head = pad("target", 8) + padL("n", 8) + padL("accuracy", 10) + padL("base", 8) + padL("naive", 8) + padL("skill", 8) + padL("AUC", 7) + padL("brier", 8) + padL("naive", 8) + padL("conf acc", 10) + padL("conf%", 7);
  console.log(head);
  console.log("-".repeat(head.length));
  for (const t of v.targets) {
    console.log(
      pad(t.target, 8) + padL(t.n, 8) + padL((t.accuracy * 100).toFixed(1) + "%", 10) + padL((t.baseRate * 100).toFixed(1) + "%", 8) +
      padL((t.naiveBest * 100).toFixed(1) + "%", 8) + padL(pct(t.skill), 8) + padL(t.auc.toFixed(3), 7) + padL(t.brier.toFixed(4), 8) +
      padL(t.brierNaive.toFixed(4), 8) + padL((t.confidentAccuracy * 100).toFixed(1) + "%", 10) + padL((t.confidentShare * 100).toFixed(0) + "%", 7) +
      "   " + describeAuc(t.auc)
    );
  }
  const s = (x: typeof v.ic, unit = "") =>
    `mean ${x.mean >= 0 ? "+" : ""}${x.mean.toFixed(3)}${unit}  sd ${x.std.toFixed(3)}  IR ${x.ir.toFixed(2)}  t ${x.tStat.toFixed(2)} on ${x.independent} independent dates (${x.dates} total)`;
  console.log(`\nIC   p(up)   vs forward return:          ${s(v.ic)}`);
  console.log(`IC   rank score vs forward relative return: ${s(v.icRel)}`);
  if (v.icBeat) console.log(`IC   p(beat) vs forward relative return:    ${s(v.icBeat)}`);
  console.log(`Top fifth minus bottom fifth by rank score, relative to the index, per ${v.horizon} sessions: ${s(v.spread, "%")}`);
  if (v.zones) {
    const z = v.zones, w = z.walk;
    const f = (x: number) => (x * 100).toFixed(0) + "%";
    console.log(`\nZones read off the path curve, share of paths that reached them (model / plain walk; the targets are 50, 25, 10, 50, 25):`);
    console.log(`  buy top ${f(z.buyHigh)} / ${f(w.buyHigh)}   buy bottom ${f(z.buyLow)} / ${f(w.buyLow)}   fail ${f(z.fails)} / ${f(w.fails)}   sell bottom ${f(z.sellLow)} / ${f(w.sellLow)}   sell top ${f(z.sellHigh)} / ${f(w.sellHigh)}   on ${z.n.toLocaleString()} paths`);
  }
  if (v.calibration) {
    console.log(`\nWhat each tenth of the ranking then did (1 = bottom, 10 = top), relative return per ${v.horizon} sessions and share beating the market:`);
    console.log("  " + v.calibration.map((c) => `${c.decile}: ${c.meanRelPct >= 0 ? "+" : ""}${c.meanRelPct.toFixed(2)}% (${(c.beatRate * 100).toFixed(0)}%)`).join("  "));
  }

  const rows = v.perSymbol.filter((p) => held.includes(p.symbol) || TRAIN_INDICES.includes(p.symbol));
  if (rows.length) {
    const h2 = pad("symbol", 8) + padL("n", 6) + padL("acc", 8) + padL("naive", 8) + padL("skill", 8) + padL("AUC up", 8) + padL("AUC dip", 9) + padL("rule", 9) + padL("hold", 9) + padL("edge", 8) + padL("in mkt", 8);
    console.log("\nYour names and the indices:");
    console.log(h2);
    console.log("-".repeat(h2.length));
    for (const p of rows) {
      console.log(
        pad(p.symbol, 8) + padL(p.n, 6) + padL((p.accuracy * 100).toFixed(1) + "%", 8) + padL((p.naiveBest * 100).toFixed(1) + "%", 8) + padL(pct(p.skill), 8) +
        padL(p.auc.toFixed(3), 8) + padL(p.aucDip.toFixed(3), 9) + padL(pct(p.rule.totalRetPct, 0), 9) + padL(pct(p.buyHold.totalRetPct, 0), 9) +
        padL(pct(p.edgePct, 0), 8) + padL(p.rule.timeInPct.toFixed(0) + "%", 8)
      );
    }
    const beat = rows.filter((p) => !TRAIN_INDICES.includes(p.symbol) && p.edgePct > 0).length;
    const names = rows.filter((p) => !TRAIN_INDICES.includes(p.symbol)).length;
    console.log(`The confident-long rule beat buy-and-hold on ${beat} of ${names} held names.`);
  }
  const allNames = v.perSymbol.filter((p) => !TRAIN_INDICES.includes(p.symbol));
  const beatAll = allNames.filter((p) => p.edgePct > 0).length;
  const meanAuc = allNames.reduce((s2, p) => s2 + p.auc, 0) / Math.max(1, allNames.length);
  const meanDip = allNames.reduce((s2, p) => s2 + p.aucDip, 0) / Math.max(1, allNames.length);
  console.log(`Across all ${allNames.length} names: mean AUC(up) ${meanAuc.toFixed(3)}, mean AUC(dip) ${meanDip.toFixed(3)}, rule beat hold on ${beatAll} (${((beatAll / Math.max(1, allNames.length)) * 100).toFixed(0)}%).`);
}

export function optionsFromArgs(): PanelOptions {
  const learner = (argOf("learner") ?? DEFAULT_PANEL.learner) as PanelOptions["learner"];
  return {
    ...DEFAULT_PANEL,
    horizon: num("horizon", DEFAULT_PANEL.horizon),
    seeds: num("seeds", DEFAULT_PANEL.seeds),
    step: num("step", DEFAULT_PANEL.step),
    minTrain: num("minTrain", DEFAULT_PANEL.minTrain),
    threshold: num("threshold", DEFAULT_PANEL.threshold),
    learner,
    train: {
      ...DEFAULT_PANEL.train,
      hidden: has("hidden") ? (argOf("hidden") ?? "").split(",").filter(Boolean).map(Number) : DEFAULT_PANEL.train.hidden,
      l2: num("l2", DEFAULT_PANEL.train.l2!),
      lr: num("lr", DEFAULT_PANEL.train.lr!),
      epochs: num("epochs", DEFAULT_PANEL.train.epochs!),
      batch: num("batch", DEFAULT_PANEL.train.batch!),
      patience: num("patience", DEFAULT_PANEL.train.patience!),
    },
    gbm: {
      ...DEFAULT_PANEL.gbm,
      rounds: num("rounds", DEFAULT_PANEL.gbm.rounds!),
      maxDepth: num("depth", DEFAULT_PANEL.gbm.maxDepth!),
      minLeaf: num("minLeaf", DEFAULT_PANEL.gbm.minLeaf!),
      lr: num("gbmLr", DEFAULT_PANEL.gbm.lr!),
      patience: num("gbmPatience", DEFAULT_PANEL.gbm.patience!),
      subsample: num("subsample", DEFAULT_PANEL.gbm.subsample!),
      earlyStop: has("earlyStop") ? true : has("fixedRounds") ? false : DEFAULT_PANEL.gbm.earlyStop,
    },
  };
}

