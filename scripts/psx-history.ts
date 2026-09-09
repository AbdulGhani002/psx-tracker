// Pull the whole market's daily closing sheet from the PSX data portal, one
// day at a time, back to 2002, and assemble it into per-symbol histories.
//
//   npx tsx scripts/psx-history.ts --out DIR [--from 2002-01-01] [--to 2026-09-09] [--concurrency 3] [--assemble-only]
//
// Each day is saved as it arrives so the run can be stopped and resumed, and
// a holiday is saved as an empty day so it is never asked for twice.
//
// The five-year EOD feed the app runs on is a subset of this. The point of
// pulling twenty-four years is to test the model against everything the
// exchange has been through since 2002: the 2005 and 2008 crashes, the 2008
// floor, the 2012 to 2017 run, the 2017 to 2019 slide, Covid, the 2022 to
// 2023 default scare and the 2024 to 2025 boom.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fetchHistoricalDay, weekdaysBetween, type DayRow } from "../lib/timeseries/psx-history";

const argOf = (n: string) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const OUT = argOf("out") || join(process.env.TEMP || ".", "psx-history");
const FROM = argOf("from") || "2002-01-01";
const TO = argOf("to") || new Date().toISOString().slice(0, 10);
const CONC = Number(argOf("concurrency") || 3);
const ASSEMBLE_ONLY = process.argv.includes("--assemble-only");
const DAYS = join(OUT, "days");
const SYMS = join(OUT, "symbols");
mkdirSync(DAYS, { recursive: true });
mkdirSync(SYMS, { recursive: true });

async function download() {
  const dates = weekdaysBetween(FROM, TO).filter((d) => !existsSync(join(DAYS, d + ".json")));
  console.log(`${dates.length} days to fetch (${FROM} to ${TO}), ${CONC} at a time.`);
  let done = 0, traded = 0, failed = 0;
  const t0 = Date.now();
  const queue = [...dates];
  const worker = async () => {
    while (queue.length) {
      const date = queue.shift()!;
      try {
        const rows = await fetchHistoricalDay(date);
        writeFileSync(join(DAYS, date + ".json"), JSON.stringify(rows));
        if (rows.length > 0) traded++;
      } catch (e) {
        failed++;
        console.log(`  FAILED ${date}: ${String(e)}`);
      }
      done++;
      if (done % 100 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${dates.length} days, ${traded} trading days, ${failed} failed, ${rate.toFixed(1)}/s, ~${((dates.length - done) / rate / 60).toFixed(0)} min left`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`Downloaded ${done} days (${traded} trading days, ${failed} failed) in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
}

// Per-symbol files: rows of [yyyymmdd, open, high, low, close, volume].
function assemble() {
  const files = readdirSync(DAYS).filter((f) => f.endsWith(".json")).sort();
  const series = new Map<string, number[][]>();
  let tradingDays = 0;
  for (const f of files) {
    const date = f.slice(0, 10);
    const rows: DayRow[] = JSON.parse(readFileSync(join(DAYS, f), "utf8"));
    if (rows.length === 0) continue;
    tradingDays++;
    const dnum = Number(date.replace(/-/g, ""));
    for (const [symbol, open, high, low, close, volume] of rows) {
      let s = series.get(symbol);
      if (!s) series.set(symbol, (s = []));
      s.push([dnum, open, high, low, close, volume]);
    }
  }
  const iso = (n: number) => String(n).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  const index: Array<{ symbol: string; bars: number; from: string; to: string }> = [];
  for (const [symbol, bars] of series) {
    if (bars.length < 250) continue;
    writeFileSync(join(SYMS, symbol + ".json"), JSON.stringify(bars));
    index.push({ symbol, bars: bars.length, from: iso(bars[0][0]), to: iso(bars[bars.length - 1][0]) });
  }
  index.sort((a, b) => a.symbol.localeCompare(b.symbol));
  writeFileSync(join(OUT, "index.json"), JSON.stringify({ tradingDays, symbols: index.length, index }));
  console.log(`${tradingDays} trading days, ${series.size} symbols seen, ${index.length} with 250+ bars written to ${SYMS}.`);
}

async function main() {
  if (!ASSEMBLE_ONLY) await download();
  assemble();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
