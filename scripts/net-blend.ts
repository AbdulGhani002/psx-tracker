// Make the blend the record. The boosted trees' out-of-sample points from the
// training run (quant-train --points), with the ranking head replaced by the
// blend of their within-day rank and PSX-Net's (ml/psxnet.py walk), scored the
// way quant-train scores its walk-forward and written into the model file
// (validation, calibration by market state, strategy, swing), and out as a
// points file for the swing rules (scripts/swing-rules.ts --book).
//
//   NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/net-blend.ts --data C:/CC/Data/psx-net --net oos-full.f32 --gbm points.json
//        --weight 0.5 --model psx-quant-model.json --out-model blended-model.json --out-points blended-points.json

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scorePanel, calibrationByState, DEFAULT_PANEL, type PanelPoint } from "../lib/quant/panel";
import { strategyBacktest, indexGate } from "../lib/quant/strategy";
import { swingBacktest } from "../lib/quant/swing";
import { loadArchive, membership, equalWeightIndex } from "../lib/quant/archive";
import { marketContext, MARKET_CONTEXT_NAMES } from "../lib/quant/context";
import { argOf, num } from "./quant-cli";

const DATA = argOf("data") || "C:/CC/Data/psx-net";
const W = num("weight", 0.5);
const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
const f32 = (f: string) => { const b = readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const i32 = (f: string) => { const b = readFileSync(f); return new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const di = i32(join(DATA, "di.i32")), sym = i32(join(DATA, "sym.i32"));
const netFile = argOf("net")!;
const net = f32(netFile.includes("/") || netFile.includes("\\") ? netFile : join(DATA, netFile));
const netAt = new Map<string, number>();
for (let k = 0; k < meta.rows; k++) if (Number.isFinite(net[k])) netAt.set(`${meta.symbols[sym[k]]}|${meta.dates[di[k]]}`, net[k]);

type Raw = [string, string, number, Array<number | null>, number | null, number | null];
const raw = JSON.parse(readFileSync(argOf("gbm")!, "utf8")) as Raw[];
const pts: PanelPoint[] = raw
  .filter((q) => netAt.has(`${q[0]}|${q[1]}`))
  .map(([symbol, date, d, p, fr, frel]) => ({ symbol, date, di: d, p: p.map((v) => (v == null ? NaN : v)), t: [], fwdRet: fr ?? 0, fwdRel: frel ?? 0 }));
console.log(`${pts.length.toLocaleString()} of ${raw.length.toLocaleString()} points have the network's score; blending at ${W} network, ${(1 - W).toFixed(2)} trees.`);

// The targets the scorer reads come from the export, row by row.
const y = f32(join(DATA, "y.f32"));
const rowOf = new Map<string, number>();
for (let k = 0; k < meta.rows; k++) rowOf.set(`${meta.symbols[sym[k]]}|${meta.dates[di[k]]}`, k);
for (const q of pts) {
  const k = rowOf.get(`${q.symbol}|${q.date}`)!;
  q.t = Array.from(y.subarray(k * 10, k * 10 + 10));
}

// Within each day: the trees' rank, the network's rank, blended.
const byDay = new Map<number, PanelPoint[]>();
for (const q of pts) (byDay.get(q.di) ?? byDay.set(q.di, []).get(q.di)!).push(q);
for (const g of byDay.values()) {
  const n = g.length;
  const rank = (v: (q: PanelPoint) => number) => {
    const r = new Map<PanelPoint, number>();
    [...g].sort((a, b) => v(a) - v(b)).forEach((q, pos) => r.set(q, n > 1 ? pos / (n - 1) : 0.5));
    return r;
  };
  const gr = rank((q) => q.p[3]), nr = rank((q) => netAt.get(`${q.symbol}|${q.date}`)!);
  for (const q of g) q.p[3] = W * nr.get(q)! + (1 - W) * gr.get(q)!;
}

const bars = loadArchive(argOf("archive") || "C:/CC/Data/psx-history");
const index = equalWeightIndex(bars, membership(bars, meta.top ?? 120));
const market = marketContext(bars, index);
const brIdx = (MARKET_CONTEXT_NAMES as readonly string[]).indexOf("brAbove200");
const breadth200 = new Map<string, number>();
for (const [d, v] of market) breadth200.set(d, v[brIdx] + 0.5);
const gate = indexGate(index);

const model = JSON.parse(readFileSync(argOf("model")!, "utf8"));
const old = model.validation;
const validation = scorePanel(pts, { ...DEFAULT_PANEL, horizon: model.horizon ?? 20 }, old?.windows ?? 0, old?.symbols ?? meta.symbols.length, false);
validation.calibrationByState = calibrationByState(pts, gate);
if (old?.zones) validation.zones = old.zones;
if (old?.medianRounds) validation.medianRounds = old.medianRounds;
const strategy = strategyBacktest(pts, index, breadth200, { horizon: model.horizon ?? 20, cashYieldPct: 10, costPct: 0.3 });
const swing = swingBacktest(pts, bars, gate, model.horizon ?? 20, undefined, { walkLevels: model.zoneSource === "walk" });
console.log(`Blended record: rank IC ${validation.icRel.mean.toFixed(4)} (t ${validation.icRel.tStat.toFixed(2)}), spread ${validation.spread.mean.toFixed(2)}% (t ${validation.spread.tStat.toFixed(2)}); was IC ${old?.icRel?.mean?.toFixed(4)}, spread ${old?.spread?.mean?.toFixed(2)}%.`);
model.validation = validation;
model.strategy = strategy;
model.swing = swing;
model.blend = { kind: "psx-net", weight: W, net: netFile.replace(/^.*[\\/]/, ""), at: new Date().toISOString() };
writeFileSync(argOf("out-model")!, JSON.stringify(model));
const r4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
writeFileSync(argOf("out-points")!, JSON.stringify(pts.map((q) => [q.symbol, q.date, q.di, q.p.map(r4), r4(q.fwdRet), r4(q.fwdRel)])));
console.log(`Wrote ${argOf("out-model")} and ${argOf("out-points")}.`);
