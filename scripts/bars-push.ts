// Fetch the day's bars here and hand them to the server's cache, so the
// report never depends on the server being able to reach the PSX portal.
//
//   npx tsx scripts/bars-push.ts [--out FILE] [--held A,B] [--symbols A,B]
//
// Writes one JSON bundle {fetchedAt, series: {SYMBOL: bars}} for the three
// indices, today's KSE-100 members and the held names. scripts/bars-push.sh
// uploads it and jobs/quant-import.js puts each series under eod:bars:SYMBOL
// with the same fetchedAt, which is what the report's six-hour cache reads.
// Requests go out one at a time with a pause, which is how a person's browser
// would look to the portal.

import { writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fetchEodBars, type EodBar } from "../lib/timeseries/psx-eod";
import { kse100Symbols, TRAIN_INDICES } from "../lib/quant/universe";

const argOf = (n: string) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DEFAULT_HELD = ["AHCL", "HINOON", "HUBC", "INDU", "LUCK", "MARI", "MEBL", "MUREB", "PPL", "PTL"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const t0 = Date.now();
  const out = argOf("out") || join(process.env.TEMP || ".", "psx-bars-bundle.json");
  const held = (argOf("held") ?? DEFAULT_HELD.join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const extra = (argOf("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const uni = await kse100Symbols();
  const symbols = [...new Set([...TRAIN_INDICES, ...uni.symbols, ...held, ...extra])];
  console.log(`Fetching ${symbols.length} series (universe ${uni.source})...`);
  const series: Record<string, EodBar[]> = {};
  let failed = 0;
  for (const s of symbols) {
    try {
      const bars = await fetchEodBars(s);
      if (bars.length > 0) series[s] = bars;
      else failed++;
    } catch {
      failed++;
    }
    await sleep(350);
  }
  const bundle = { fetchedAt: new Date().toISOString(), series };
  writeFileSync(out, JSON.stringify(bundle));
  const last = series.KSE100?.[series.KSE100.length - 1];
  console.log(`Wrote ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MiB): ${Object.keys(series).length} series, ${failed} failed, KSE-100 to ${last?.date ?? "?"}, in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
  if (!series.KSE100) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
