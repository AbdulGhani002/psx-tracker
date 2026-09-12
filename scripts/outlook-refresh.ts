// Rebuild the KSE-100 state table inside an already trained model file and
// write the file back, without retraining the boosters.
//
//   npx tsx scripts/outlook-refresh.ts --model FILE [--archive DIR]
//
// Used when the table gains a field (the path depths, for one) and the
// weekly training is days away. scripts/outlook-refresh.sh pushes the result
// the same way scripts/quant-push.sh does.

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadArchive, equalWeightIndex } from "../lib/quant/archive";
import { marketContext, MARKET_CONTEXT_NAMES } from "../lib/quant/context";
import { loadLongIndex } from "../lib/quant/index-history";
import { indexStates, fitCells, evaluateCells, cellOutlook } from "../lib/quant/outlook";
import { diskBarsCache, type StoredQuantModel, type StoredIndexOutlook } from "../lib/quant/store";
import { argOf } from "./quant-cli";

async function main() {
  const file = argOf("model") ?? join(process.env.TEMP || process.env.TMP || ".", "psx-quant-model.json");
  const archiveDir = argOf("archive") ?? "C:/CC/Data/psx-history";
  const model = JSON.parse(readFileSync(file, "utf8")) as StoredQuantModel;
  console.log(`model trained ${model.trainedOn}, ${model.targetNames.length} heads; table was ${model.indexOutlook ? `${model.indexOutlook.seriesFrom} to ${model.indexOutlook.seriesTo}` : "absent"}.`);

  const bars = loadArchive(archiveDir);
  const ew = equalWeightIndex(bars);
  const market = marketContext(bars, ew);
  const brIdx = (MARKET_CONTEXT_NAMES as readonly string[]).indexOf("brAbove200");
  const breadth200 = new Map<string, number>();
  for (const [d, v] of market) if (v.some((x) => x !== 0)) breadth200.set(d, v[brIdx] + 0.5);

  const cacheDir = process.env.QUANT_CACHE || join(process.env.TEMP || process.env.TMP || ".", "psx-quant-cache");
  const longIdx = await loadLongIndex(diskBarsCache(cacheDir, 24 * 7));
  if (!longIdx) throw new Error("KSE-100 long series unavailable");
  const states = indexStates(longIdx.bars, model.horizon, breadth200);
  const { record, years } = evaluateCells(states, { horizon: model.horizon, level: 1, shrink: 20, fromYear: 2005 });
  const cells = fitCells(states, model.horizon, 20);
  const out: StoredIndexOutlook = { model: cells, record, yearly: years, seriesFrom: longIdx.bars[0].date, seriesTo: longIdx.bars[longIdx.bars.length - 1].date, joinedAt: longIdx.joinedAt };
  model.indexOutlook = out;
  const last = states[states.length - 1];
  const o = cellOutlook(cells, last, 1);
  console.log(`table on ${longIdx.bars.length} sessions to ${out.seriesTo}; walk-forward Brier skill ${record.brierSkillPct.toFixed(1)}%, dip skill ${record.dipSkillPct.toFixed(1)}%, cover80 ${(record.cover80 * 100).toFixed(0)}%.`);
  console.log(`today ${last.date} ${last.close.toFixed(0)}: ${o.label}, ${Math.round(o.periods)} periods, up ${(o.pUp * 100).toFixed(0)}%, zone ${JSON.stringify(o.zone)}`);
  writeFileSync(file, JSON.stringify(model));
  console.log(`wrote ${file} (${(statSync(file).size / 1024).toFixed(0)} KiB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
