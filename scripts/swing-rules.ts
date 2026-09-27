// Re-test swing rules on saved out-of-sample predictions, without retraining.
//
//   npx tsx scripts/swing-rules.ts --points FILE [--archive DIR] [--top 120] [--horizon 20] [--walk] [--patch MODEL.json]
//
// FILE is what scripts/quant-train.ts --points wrote: the walk-forward's
// predictions for every name and date. The bars and the equal-weight index are
// rebuilt from the archive exactly as the training run built them, so the
// levels, the market gate and the fills are the ones the run would have used.
// --walk reads the zones off the plain walk (what the site shows when the
// model's path curve did not beat it). --patch writes the results into a model
// file's `swing` field before it is imported.

import { readFileSync, writeFileSync } from "node:fs";
import { loadArchive, membership, equalWeightIndex } from "../lib/quant/archive";
import { indexGate } from "../lib/quant/strategy";
import { swingBacktest, swingTable, DEFAULT_SWING_RULES } from "../lib/quant/swing";
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
const stats = swingBacktest(points, bars, indexGate(index), num("horizon", 20), DEFAULT_SWING_RULES, { walkLevels: has("walk") });
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
