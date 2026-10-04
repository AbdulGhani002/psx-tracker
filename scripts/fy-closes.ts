// The exchange's actual close of every name on each financial year's last
// trading day (on or before 30 June), from the archive's daily files, for
// the profit by financial year (lib/analytics/fy.ts). A name that did not
// trade that day takes its last close in the six weeks before.
//
//   npx tsx scripts/fy-closes.ts --archive C:/CC/Data/psx-history --out fy-closes.json [--from 2004]
//   node jobs/quant-import.js fy-closes.json prices:fy-closes        (on the server)
//
// The years after the archive come from the closing sheets the server keeps.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argOf, num } from "./quant-cli";

const dir = join(argOf("archive") || "C:/CC/Data/psx-history", "days");
const out = argOf("out") || "fy-closes.json";
const from = num("from", 2004);
const days = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
const lastDay = days[days.length - 1];

const result: Record<string, Record<string, number>> = {};
for (let y = from; ; y++) {
  const end = `${y}-06-30`;
  if (end > lastDay) break;
  const back = new Date(Date.parse(end + "T00:00:00Z") - 45 * 86400000).toISOString().slice(0, 10);
  const window = days.filter((d) => d >= back && d <= end).reverse();
  const closes: Record<string, number> = {};
  for (const d of window) {
    const rows = JSON.parse(readFileSync(join(dir, d + ".json"), "utf8")) as Array<[string, number, number, number, number, number, number]>;
    for (const r of rows) if (!(r[0] in closes) && r[4] > 0) closes[r[0]] = Math.round(r[4] * 10000) / 10000;
  }
  result[end] = closes;
  console.log(`${end}: last trading day ${window[0] ?? "-"}, ${Object.keys(closes).length} names`);
}
writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out} (${Object.keys(result).length} years)`);
