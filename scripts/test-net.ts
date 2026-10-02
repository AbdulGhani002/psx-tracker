// PSX-Net's TypeScript forward pass against PyTorch's, on a real day: the
// server runs the TypeScript one, so it must give the same scores.
//
//   python ml/psxnet.py parity --model MODEL.json --out PARITY.json
//   npx tsx scripts/test-net.ts MODEL.json PARITY.json

import { readFileSync } from "node:fs";
import { scoreDay, rankDay, dayTab, type NetWeights } from "../lib/quant/net-infer";
import { sequenceAt, SEQ_LEN, SEQ_CHANNELS } from "../lib/quant/net-seq";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const [modelFile, parityFile] = process.argv.slice(2);
if (modelFile && parityFile) {
  const w = JSON.parse(readFileSync(modelFile, "utf8")) as NetWeights;
  const par = JSON.parse(readFileSync(parityFile, "utf8")) as { date: string; tab: number[][]; seq: number[][]; score: number[]; aux: number[][] };
  const t0 = Date.now();
  const { score, aux } = scoreDay(w.cfg, w.models[0].state, w.mean, w.std, { tab: par.tab, seq: par.seq });
  const ms = Date.now() - t0;
  const maxDiff = Math.max(...score.map((s, i) => Math.abs(s - par.score[i])));
  const spread = Math.max(...par.score) - Math.min(...par.score);
  check(`scores match PyTorch on ${par.date} (${score.length} names, ${ms} ms)`, maxDiff < 1e-3 * Math.max(1, spread), `max diff ${maxDiff.toExponential(2)} on a spread of ${spread.toFixed(3)}`);
  const auxDiff = Math.max(...aux.flat().map((v, i) => Math.abs(v - par.aux.flat()[i])));
  check("side heads match", auxDiff < 1e-3, auxDiff.toExponential(2));
  const order = (v: number[]) => v.map((_, i) => i).sort((a, b) => v[a] - v[b]).join();
  check("and so does the day's order", order(score) === order(par.score));
  const r = rankDay(w, { tab: par.tab, seq: par.seq });
  check("the ensemble's ranks run 0 to 1", Math.min(...r) >= 0 && Math.max(...r) <= 1 && r.length === par.tab.length);
}

// The history: oldest first, a flag per step, zeros before the name existed.
const cal = ["d1", "d2", "d3"];
const s = new Map<string, [number, number, number]>([["d2", [1, 2, 3]], ["d3", [4, 5, 6]]]);
const q = sequenceAt(s, cal, 2);
const step = SEQ_CHANNELS + 1;
check("the latest session is the last step", q.slice((SEQ_LEN - 1) * step).join() === "4,5,6,1");
check("the one before it the step before", q.slice((SEQ_LEN - 2) * step, (SEQ_LEN - 1) * step).join() === "1,2,3,1");
check("a session before the name's history is zeros with the flag off", q.slice((SEQ_LEN - 3) * step, (SEQ_LEN - 2) * step).join() === "0,0,0,0");

// The index's own state as the day's value: the median of the names' raw
// readings in the dayRaw columns, the ranks elsewhere untouched.
const xsRows = [[0.1, -0.5, 0.3], [0.2, 0.5, -0.3], [0.3, 0.0, 0.0]];
const rawRows = [[9, 0.25, 7], [9, 0.27, 7], [9, 0.20, 7]];
const t = dayTab(xsRows, rawRows, [1]);
check("a dayRaw column is the median of the raw readings for every name", t.every((r) => r[1] === 0.25));
check("the other columns keep their ranks", t.map((r) => r[0]).join() === "0.1,0.2,0.3" && t.map((r) => r[2]).join() === "0.3,-0.3,0");
check("an even count takes the mean of the middle two, as numpy's median", dayTab([[0], [0]], [[1], [2]], [0])[0][0] === 1.5);
check("without dayRaw columns the rows pass through", dayTab(xsRows, rawRows, undefined) === xsRows);

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
