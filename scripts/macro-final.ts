// Train the strategy model on everything the archive knows and write it for
// the server (lib/macro/artifact.ts): the network that ranks shares, walked
// forward first so its record and what each tenth of its ranking went on to
// do travel with it, beside the plain rules it has to beat; then the macro
// study (scripts/macro-study-core.ts).
//
//   NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/macro-final.ts --archive C:/CC/Data/psx-history
//        --macro C:/CC/Data/macro --out C:/CC/Data/macro/macro-model.json [--features base|sens] [--seeds 5]

import { writeFileSync } from "node:fs";
import { loadInputs } from "./macro-inputs";
import { runStudy, ANALOG, FACTOR_LABELS } from "./macro-study-core";
import { STOCK_NAMES, SECTOR_NAMES, SENS_NAMES, type PanelRow } from "../lib/macro/panel";
import { MACRO_NAMES } from "../lib/macro/series";
import { walkForward, scoreMonths, summarise } from "../lib/macro/models";
import { trainMlp, predictMlp, type Mlp, type MlpOptions } from "../lib/macro/mlp";
import { trainGbm, predictGbm } from "../lib/quant/gbm";
import { calibrate, type MacroModel } from "../lib/macro/artifact";
import { argOf } from "./quant-cli";

const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const L = loadInputs(argOf("archive") || "C:/CC/Data/psx-history", argOf("macro") || "C:/CC/Data/macro");
const NAMES: string[] = [...STOCK_NAMES, ...SECTOR_NAMES, ...MACRO_NAMES, ...SENS_NAMES];
const features: string[] = argOf("features") === "sens" ? [...STOCK_NAMES, ...SECTOR_NAMES, ...SENS_NAMES] : [...STOCK_NAMES, ...SECTOR_NAMES];
const idx = features.map((n) => NAMES.indexOf(n));
const pick = (x: number[]) => idx.map((j) => x[j]);
const SEEDS = Number(argOf("seeds") || 5);
const OPTS: MlpOptions = { hidden: [64, 32], epochs: 30, batch: 256, lr: 1e-3, dropout: 0.2, weightDecay: 1e-4, valFrac: 0.15, patience: 5 };
const lastYear = Number(L.monthEnds[L.monthEnds.length - 1].slice(0, 4));
console.log(`${secs()} panel: ${L.rows.length} rows, ${features.length} inputs, ${SEEDS} seeds`);

const trainNets = (tr: PanelRow[]): Mlp[] => {
  const X = tr.map((r) => pick(r.x)), y = tr.map((r) => r.pct3!);
  return Array.from({ length: SEEDS }, (_, k) => trainMlp(X, y, { ...OPTS, seed: k + 1 }));
};
const score = (nets: Mlp[]) => (x: number[]) => nets.reduce((s, m) => s + predictMlp(m, pick(x)), 0) / nets.length;

// The record, on the same walk as the research.
const preds = walkForward(L.rows, (tr) => score(trainNets(tr)), { fromYear: 2008, toYear: lastYear });
const record = summarise(scoreMonths(L.rows, preds));
const calibration = calibrate(L.rows, preds);
console.log(`${secs()} network: IC ${record.ic.toFixed(3)} (t ${record.icT.toFixed(1)}), spread ${(record.spread * 100).toFixed(2)}%, sector IC ${record.sectorIc.toFixed(3)}`);
console.log(`${secs()} each tenth, 3 months against the market: ${calibration.map((c) => `${(c.rel3 * 100).toFixed(1)}%`).join(" ")}`);

// The plain rules it is shown beside.
const col = (n: string) => NAMES.indexOf(n);
const plain: Array<[string, (tr: PanelRow[]) => (x: number[]) => number]> = [
  ["Momentum", () => (x) => x[col("rel12Rank")]],
  ["Momentum and dividend yield", () => (x) => (x[col("rel12Rank")] + x[col("dyRank")]) / 2],
  ["Boosted trees", (tr) => {
    const s = (x: number[]) => pick(x).map((v) => (Number.isFinite(v) ? v : -1e9));
    const m = trainGbm(tr.map((r) => s(r.x)), tr.map((r) => r.pct3!), { rounds: 300, lr: 0.03, maxDepth: 3, minLeaf: 300, subsample: 0.7, colsample: 0.7, valFrac: 0.1, patience: 40, seed: 7 });
    return (x) => predictGbm(m, s(x));
  }],
];
const baselines = plain.map(([name, fit]) => {
  const r = summarise(scoreMonths(L.rows, walkForward(L.rows, fit, { fromYear: 2008, toYear: lastYear })));
  return { name, ic: r.ic, icT: r.icT, spread: r.spread, sectorIc: r.sectorIc };
});
console.log(`${secs()} baselines: ${baselines.map((b) => `${b.name} ${b.ic.toFixed(3)}`).join(", ")}`);

// The final networks, on every month whose outcome is known.
const known = L.rows.filter((r) => r.pct3 != null);
const nets = trainNets(known);
console.log(`${secs()} final: ${nets.length} networks on ${known.length} rows to ${known[known.length - 1].date}`);

const study = runStudy(L);
const model: MacroModel = {
  version: 1,
  builtAt: new Date().toISOString(),
  dataTo: L.monthEnds[L.monthEnds.length - 1],
  trainedTo: known[known.length - 1].date,
  universe: "each year's 120 most traded names on the exchange (2003 on)",
  features,
  nets,
  record,
  baselines,
  sensitivities: { factors: FACTOR_LABELS, rows: study.sensitivities },
  timing: study.timing,
  analogNames: [...ANALOG],
  analogHistory: study.analogHistory,
  calibration,
};
const out = argOf("out") || "C:/CC/Data/macro/macro-model.json";
writeFileSync(out, JSON.stringify(model));
console.log(`${secs()} wrote ${out}: ${(JSON.stringify(model).length / 1024).toFixed(0)} KB`);
