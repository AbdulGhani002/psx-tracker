// Fetch the day's bars here and hand them to the server's cache, so the
// report never depends on the server being able to reach the PSX portal.
//
//   npx tsx scripts/bars-push.ts [--archive DIR] [--out FILE] [--held A,B] [--symbols A,B]
//
// Writes one JSON bundle {fetchedAt, series: {SYMBOL: bars}} for the three
// indices, today's KSE-100 members and the held names. scripts/bars-push.sh
// uploads it and jobs/quant-import.js puts each series under eod:bars:SYMBOL
// with the same fetchedAt, which is what the report's six-hour cache reads.
//
// With --archive, stock series come from the exchange's archive, adjusted for
// bonus issues and splits from its own LDCP column (the live feed is not
// consistently adjusted: MARI's 1:10 of September 2024 is still a 90% crash
// in it), and the live feed only supplies today's close, appended when its
// previous close matches the archive's. Indices always come from the live
// feed. Requests go out one at a time with a pause.

import { writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fetchEodBars, type EodBar } from "../lib/timeseries/psx-eod";
import { fetchPayouts, type PsxPayout } from "../lib/prices/payouts";
import { fetchFundamentals } from "../lib/prices/fundamentals";
import { kse100Symbols, TRAIN_INDICES } from "../lib/quant/universe";
import { loadArchive, appendLive } from "../lib/quant/archive";

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
  const archiveDir = argOf("archive");
  const archive = archiveDir ? loadArchive(archiveDir, new Set(symbols)) : null;
  console.log(`Fetching ${symbols.length} series (universe ${uni.source})${archive ? `; ${archive.size} stock series from the adjusted archive, live feed for the latest close` : ""}...`);
  const series: Record<string, EodBar[]> = {};
  let failed = 0, appended = 0, fromArchive = 0;
  for (const s of symbols) {
    try {
      const live = await fetchEodBars(s).catch(() => [] as EodBar[]);
      const arch = archive?.get(s);
      if (arch && arch.length >= 250) {
        const bars = arch.map((b) => ({ ...b }));
        appended += appendLive(bars, live);
        series[s] = bars;
        fromArchive++;
      } else if (live.length > 0) {
        series[s] = live;
      } else failed++;
    } catch {
      failed++;
    }
    await sleep(350);
  }
  if (archive) console.log(`${fromArchive} series from the archive, ${appended} live closes appended.`);
  // Payout boards (dividends, bonuses, rights with their book closures) for
  // the held names, so the server can record entitlements without reaching
  // the portal itself.
  const payouts: Record<string, PsxPayout[]> = {};
  const faceValues: Record<string, number> = {};
  for (const s of [...new Set([...held, ...extra])]) {
    try {
      const rows = await fetchPayouts(s);
      if (rows) payouts[s] = rows;
      await sleep(400);
      const f = await fetchFundamentals(s).catch(() => null);
      if (f?.faceValue && f.faceValue > 0) faceValues[s] = f.faceValue;
    } catch {
      /* the board is optional; bars still ship */
    }
    await sleep(400);
  }
  console.log(`Payout boards for ${Object.keys(payouts).length} of ${new Set([...held, ...extra]).size} held names.`);
  const bundle = { fetchedAt: new Date().toISOString(), series, payouts, faceValues };
  writeFileSync(out, JSON.stringify(bundle));
  const last = series.KSE100?.[series.KSE100.length - 1];
  console.log(`Wrote ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MiB): ${Object.keys(series).length} series, ${failed} failed, KSE-100 to ${last?.date ?? "?"}, in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
  if (!series.KSE100) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
