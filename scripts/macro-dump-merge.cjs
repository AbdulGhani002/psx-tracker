// The server's macro dump (scripts/macro-dump.cjs) laid over the one kept here,
// so a series the server keeps only the recent part of keeps its long past:
// each series by date and CPI by month, the newer reading winning; the company
// figures are the server's.
//   node scripts/macro-dump-merge.cjs KEPT.json.gz NEW.json OUT.json.gz
const fs = require("fs");
const zlib = require("zlib");

const [keptFile, newFile, outFile] = process.argv.slice(2);
const kept = fs.existsSync(keptFile) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(keptFile)).toString()) : { macro: {}, cpi: [], fund: [] };
const fresh = JSON.parse(fs.readFileSync(newFile, "utf8"));
const macro = {};
for (const name of new Set([...Object.keys(kept.macro || {}), ...Object.keys(fresh.macro || {})])) {
  const by = new Map((kept.macro?.[name] || []).map((p) => [p[0], p[1]]));
  for (const p of fresh.macro?.[name] || []) by.set(p[0], p[1]);
  macro[name] = [...by].sort((a, b) => a[0].localeCompare(b[0]));
}
const cpiBy = new Map((kept.cpi || []).map((p) => [p.period, p]));
for (const p of fresh.cpi || []) cpiBy.set(p.period, p);
const out = { macro, cpi: [...cpiBy.values()].sort((a, b) => a.period.localeCompare(b.period)), fund: fresh.fund?.length ? fresh.fund : kept.fund };
fs.writeFileSync(outFile, zlib.gzipSync(JSON.stringify(out)));
console.log(Object.entries(macro).map(([k, v]) => `${k} ${v.length} to ${v[v.length - 1]?.[0] ?? "-"}`).join(", ") + `; CPI ${out.cpi.length} months; ${out.fund.length} companies`);
