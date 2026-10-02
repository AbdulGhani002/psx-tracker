// Export the 24-year archive panel for the GPU network (ml/psxnet.py): the
// same rows, features and targets the boosted trees train on, as flat binary
// arrays, plus every member name's daily series (lib/quant/net-seq.ts) on the
// panel's calendar for the network's own view of the recent past.
//
//   NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/net-export.ts --archive C:/CC/Data/psx-history --out C:/CC/Data/psx-net
//
// Files (little-endian):
//   xs.f32    rows x dXs   the cross-sectional view: own and extra features as
//                          percentile ranks on the date, market context raw
//   x.f32     rows x dX    the raw row, as the raw booster reads it
//   y.f32     rows x 10    targets (TARGET_NAMES order; rel is the percentile)
//   fwd.f32   rows x 2     forward return, forward return against the market
//   di.i32    rows         date index into meta.dates
//   sym.i32   rows         index into meta.symbols
//   seq.f32   symbols x dates x 3   ret, rel, volZ per session (NaN: no bar)
//   meta.json              names, sizes, dates, symbols

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildArchivePanel } from "../lib/quant/archive";
import { TARGET_NAMES } from "../lib/quant/features";
import { dailySeries, SEQ_CHANNELS } from "../lib/quant/net-seq";
import { argOf, num } from "./quant-cli";

const ARCHIVE = argOf("archive") || "C:/CC/Data/psx-history";
const OUT = argOf("out") || "C:/CC/Data/psx-net";
const HORIZON = num("horizon", 20);
const TOP = num("top", 120);

const t0 = Date.now();
const arch = buildArchivePanel(ARCHIVE, HORIZON, TOP, false, null, { extras: true, xs: true });
const rows = arch.panel.rows.filter((r) => r.targets != null);
const n = rows.length;
const dX = rows[0].x.length, dXs = rows[0].xs!.length;
const symbols = arch.panel.symbols;
const symIdx = new Map(symbols.map((s, i) => [s, i]));
const dates = arch.panel.dates;
console.log(`${n.toLocaleString()} rows, ${symbols.length} names, ${dates.length} dates, x ${dX}, xs ${dXs}. ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const x = new Float32Array(n * dX), xs = new Float32Array(n * dXs), y = new Float32Array(n * TARGET_NAMES.length), fwd = new Float32Array(n * 2);
const di = new Int32Array(n), sym = new Int32Array(n);
rows.forEach((r, i) => {
  x.set(r.x, i * dX);
  xs.set(r.xs!, i * dXs);
  y.set(r.targets!, i * TARGET_NAMES.length);
  fwd[i * 2] = r.fwdRet!;
  fwd[i * 2 + 1] = r.fwdRel!;
  di[i] = r.di;
  sym[i] = symIdx.get(r.symbol)!;
});

const seq = new Float32Array(symbols.length * dates.length * SEQ_CHANNELS).fill(NaN);
symbols.forEach((s, si) => {
  const series = dailySeries(arch.bars.get(s) ?? [], arch.index);
  dates.forEach((d, k) => {
    const v = series.get(d);
    if (v) seq.set(v, (si * dates.length + k) * SEQ_CHANNELS);
  });
});

mkdirSync(OUT, { recursive: true });
const write = (name: string, a: Float32Array | Int32Array) => writeFileSync(join(OUT, name), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
write("x.f32", x);
write("xs.f32", xs);
write("y.f32", y);
write("fwd.f32", fwd);
write("di.i32", di);
write("sym.i32", sym);
write("seq.f32", seq);
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify({ rows: n, dX, dXs, targets: TARGET_NAMES, featureNames: arch.featureNames, contextNames: arch.contextNames, horizon: HORIZON, top: TOP, seqChannels: SEQ_CHANNELS, symbols, dates, exportedAt: new Date().toISOString() })
);
console.log(`Wrote ${OUT}: ${((x.byteLength + xs.byteLength + y.byteLength + fwd.byteLength + seq.byteLength) / 1e6).toFixed(0)} MB. ${((Date.now() - t0) / 1000).toFixed(0)}s`);
