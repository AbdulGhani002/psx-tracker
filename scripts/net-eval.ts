// The network's out-of-sample ranking (ml/psxnet.py walk) beside the boosted
// trees' (quant-train --points) on the same rows and the measures quant-lab
// uses, and blends of the two by within-date rank.
//
//   npx tsx scripts/net-eval.ts --data C:/CC/Data/psx-net --net oos-full.f32,oos-mlp.f32 --gbm points.json [--archive DIR] [--weights 0.5,0.67]
//
// Only rows every source scored are compared, so the sample is the same.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spearman, type PanelPoint } from "../lib/quant/panel";
import { strategyBacktest } from "../lib/quant/strategy";
import { loadArchive, membership, equalWeightIndex } from "../lib/quant/archive";
import { argOf, num } from "./quant-cli";

const DATA = argOf("data") || "C:/CC/Data/psx-net";
const HORIZON = num("horizon", 20);
const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
const n: number = meta.rows;
const f32 = (f: string) => { const b = readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const i32 = (f: string) => { const b = readFileSync(f); return new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const di = i32(join(DATA, "di.i32")), sym = i32(join(DATA, "sym.i32")), fwd = f32(join(DATA, "fwd.f32")), y = f32(join(DATA, "y.f32"));
const dates: string[] = meta.dates, symbols: string[] = meta.symbols;

const sources = new Map<string, Float32Array>();
for (const f of (argOf("net") ?? "").split(",").filter(Boolean)) {
  const path = f.includes("/") || f.includes("\\") ? f : join(DATA, f);
  sources.set(f.replace(/^.*[\\/]/, "").replace(/^oos-/, "net:").replace(/\.f32$/, ""), f32(path));
}
const gbmFile = argOf("gbm");
if (gbmFile) {
  const raw = JSON.parse(readFileSync(gbmFile, "utf8")) as Array<[string, string, number, Array<number | null>]>;
  const by = new Map<string, number>();
  for (const [s, d, , p] of raw) by.set(`${s}|${d}`, (p[3] ?? p[1] ?? NaN) as number);
  const g = new Float32Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    const v = by.get(`${symbols[sym[k]]}|${dates[di[k]]}`);
    if (v != null) g[k] = v;
  }
  sources.set("gbm", g);
}
const names = [...sources.keys()];
const rows: number[] = [];
for (let k = 0; k < n; k++) if (names.every((s) => Number.isFinite(sources.get(s)![k]))) rows.push(k);
console.log(`${rows.length.toLocaleString()} rows scored by all of ${names.join(", ")} (${dates[di[rows[0]]]} to ${dates[di[rows[rows.length - 1]]]}).`);

const bars = loadArchive(argOf("archive") || "C:/CC/Data/psx-history");
const index = equalWeightIndex(bars, membership(bars, meta.top ?? 120));

// Within-date percentile of a source's score, per row.
function ranked(src: Float32Array): Map<number, number> {
  const out = new Map<number, number>();
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && di[rows[j]] === di[rows[i]]) j++;
    const g = rows.slice(i, j).sort((a, b) => src[a] - src[b]);
    g.forEach((k, pos) => out.set(k, g.length > 1 ? pos / (g.length - 1) : 0.5));
    i = j;
  }
  return out;
}

function report(name: string, score: (k: number) => number) {
  const ic: Array<{ di: number; v: number; year: number }> = [], spread: Array<{ di: number; v: number }> = [];
  const dec = Array.from({ length: 10 }, () => ({ n: 0, s: 0 }));
  const points: PanelPoint[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j < rows.length && di[rows[j]] === di[rows[i]]) j++;
    const g = rows.slice(i, j);
    for (const k of g) points.push({ symbol: symbols[sym[k]], date: dates[di[k]], di: di[k], p: [0, 0, 0, score(k)], t: Array.from(y.subarray(k * 10, k * 10 + 10)), fwdRet: fwd[k * 2], fwdRel: fwd[k * 2 + 1] });
    if (g.length >= 8) {
      ic.push({ di: di[g[0]], v: spearman(g.map(score), g.map((k) => fwd[k * 2 + 1])), year: Number(dates[di[g[0]]].slice(0, 4)) });
      const order = [...g].sort((a, b) => score(a) - score(b));
      const q = Math.max(1, Math.floor(order.length / 5));
      const mean = (arr: number[]) => arr.reduce((s, k) => s + fwd[k * 2 + 1], 0) / arr.length;
      spread.push({ di: di[g[0]], v: (mean(order.slice(-q)) - mean(order.slice(0, q))) * 100 });
      order.forEach((k, pos) => { const d = dec[Math.min(9, Math.floor((pos / order.length) * 10))]; d.n++; d.s += fwd[k * 2 + 1]; });
    }
    i = j;
  }
  const stat = (xs: Array<{ di: number; v: number }>) => {
    const first = xs[0]?.di ?? 0;
    const ind = xs.filter((x) => (x.di - first) % HORIZON === 0).map((x) => x.v);
    const m = xs.reduce((s, x) => s + x.v, 0) / Math.max(1, xs.length);
    const im = ind.reduce((s, x) => s + x, 0) / Math.max(1, ind.length);
    const isd = Math.sqrt(ind.reduce((s, x) => s + (x - im) ** 2, 0) / Math.max(1, ind.length - 1));
    return { m, t: isd > 0 ? (im / isd) * Math.sqrt(ind.length) : 0 };
  };
  const a = stat(ic), s = stat(spread);
  const era = (from: number, to: number) => {
    const e = ic.filter((x) => x.year >= from && x.year <= to);
    return e.length ? (e.reduce((s2, x) => s2 + x.v, 0) / e.length).toFixed(3) : "  -  ";
  };
  const strat = strategyBacktest(points, index, null, { horizon: HORIZON, cashYieldPct: 10, costPct: 0.3 });
  const g1 = strat?.legs[3];
  console.log(
    `\n== ${name}\nrel  IC ${a.m >= 0 ? "+" : ""}${a.m.toFixed(4)} (t ${a.t.toFixed(2)})  spread ${s.m >= 0 ? "+" : ""}${s.m.toFixed(2)}% (t ${s.t.toFixed(2)})  eras 07-12 ${era(2007, 2012)} 13-18 ${era(2013, 2018)} 19-26 ${era(2019, 2026)}` +
      (g1 ? `  gated top5th CAGR ${g1.cagrPct.toFixed(1)}% maxDD ${g1.maxDrawdownPct.toFixed(0)}%` : "") +
      `\n     deciles ${dec.map((d) => (d.n ? ((d.s / d.n) * 100).toFixed(2) : "-")).join(" ")}`
  );
}

const rk = new Map(names.map((s) => [s, ranked(sources.get(s)!)]));
for (const s of names) report(s, (k) => rk.get(s)!.get(k)!);
// Blends with the trees: the network's rank and the trees' rank, weighted.
const weights = (argOf("weights") ?? "0.5").split(",").map(Number).filter((w) => w > 0 && w < 1);
if (sources.has("gbm"))
  for (const s of names.filter((x) => x !== "gbm"))
    for (const w of weights) report(`${s} x${w} + gbm x${(1 - w).toFixed(2)}`, (k) => w * rk.get(s)!.get(k)! + (1 - w) * rk.get("gbm")!.get(k)!);
