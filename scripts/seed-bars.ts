// A bars bundle for every listed share the archive has, so the server keeps a
// series for each (the evening job extends every stored series from the
// exchange's daily file after that). Only the last `--last` sessions go up:
// the strategy model reads a year, the zones sixty days.
//
//   npx tsx scripts/seed-bars.ts --archive C:/CC/Data/psx-history --out seed-bars.json [--last 1300]
//
// scripts/seed-import.cjs puts it in on the server, skipping names it keeps.

import { writeFileSync, statSync } from "node:fs";
import symbols from "../lib/psx-symbols.json";
import { loadArchive } from "../lib/quant/archive";
import { argOf, num } from "./quant-cli";

const dir = argOf("archive") || "C:/CC/Data/psx-history";
const out = argOf("out") || "seed-bars.json";
const last = num("last", 1300);

const listed = new Set((symbols as Array<{ symbol: string; etf?: boolean }>).filter((s) => !s.etf).map((s) => s.symbol));
const bars = loadArchive(dir, listed);
const end = [...bars.values()].reduce((m, b) => (b[b.length - 1].date > m ? b[b.length - 1].date : m), "");
const cutoff = new Date(Date.parse(end + "T00:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);

const series: Record<string, unknown[]> = {};
let stale = 0;
for (const [s, b] of bars) {
  if (b[b.length - 1].date < cutoff) {
    stale++;
    continue;
  }
  series[s] = b.slice(-last);
}
writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), series }));
console.log(`${Object.keys(series).length} of ${listed.size} listed shares to ${end} (${stale} not traded in 30 days left out), ${(statSync(out).size / 1048576).toFixed(1)} MiB in ${out}`);
