// The quant stack has to prove it is honest before its numbers mean anything.
//
// The important tests here are the ones about the HARNESS, not the model:
// that features never see the future, that the walk-forward reports zero on
// pure noise, and that it reports strong skill when a signal is planted. If
// those hold, then a zero on real data is a fact about the market and not a
// bug in the code.

import { Raster, INK, PAPER } from "../lib/charts/raster";
import { renderPriceChart, sma } from "../lib/charts/price-chart";
import { buildFeatures, readTrend, FEATURE_NAMES } from "../lib/quant/features";
import { trainMlp, predictMlp, mulberry32 } from "../lib/quant/mlp";
import { walkForward, describeForecast, DEFAULT_WALK } from "../lib/quant/walkforward";
import type { EodBar } from "../lib/timeseries/psx-eod";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

const rnd = mulberry32(42);
const gauss = () => {
  const u = rnd() || 1e-9, v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
function weekdays(n: number, start = "2021-01-04"): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function randomWalk(n: number, drift = 0.0003, vol = 0.015, start = 100): EodBar[] {
  const dates = weekdays(n);
  let p = start;
  return dates.map((date) => {
    p *= Math.exp(drift + vol * gauss());
    return { date, close: p, volume: 1e6 * (0.5 + rnd()), vwap: p };
  });
}

// ------------------------------------------------------------------- PNG
{
  const r = new Raster(120, 60, 2);
  r.clear(PAPER);
  r.line(5, 5, 115, 55, INK, 2);
  r.text(10, 10, "ABC 123", INK, 2);
  const png = r.toPng();
  check("png has the signature", png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  check("png IHDR width", png.readUInt32BE(16) === 120, png.readUInt32BE(16));
  check("png IHDR height", png.readUInt32BE(20) === 60, png.readUInt32BE(20));
  check("png ends with IEND", png.subarray(png.length - 8, png.length - 4).toString("ascii") === "IEND");
  // Walk the chunks and recompute every CRC: a bad CRC is a corrupt image.
  let off = 8, chunks = 0, crcOk = true;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const body = png.subarray(off + 4, off + 8 + len);
    const stored = png.readUInt32BE(off + 8 + len);
    if (crc(body) !== stored) crcOk = false;
    chunks++;
    off += 12 + len;
  }
  check("png has three chunks", chunks === 3, chunks);
  check("every chunk CRC is right", crcOk);

  const bars = randomWalk(300);
  const closes = bars.map((b) => b.close);
  const chart = renderPriceChart({ title: "TEST", bars, ma50: sma(closes, 50), ma200: sma(closes, 200), buyZone: { low: 90, high: 100 }, avgCost: 95 });
  check("a full chart renders to a real png", chart.length > 5000 && chart.readUInt32BE(16) === 1200, chart.length);
  const tiny = renderPriceChart({ title: "EMPTY", bars: [] });
  check("an empty series still renders rather than throwing", tiny.length > 1000);
}

// -------------------------------------------------------------- features
{
  const index = randomWalk(700, 0.0004, 0.01, 40000);
  const bars = randomWalk(700, 0.0003, 0.02, 100);
  const rows = buildFeatures(bars, index, 5);
  check("features start after the 250-day warm-up", rows.length === 700 - 250, rows.length);
  check("every row has the full feature vector", rows.every((r) => r.x.length === FEATURE_NAMES.length));
  check("the last five rows have no target", rows.slice(-5).every((r) => r.y === null && r.fwdRet === null));
  check("earlier rows have a target", rows.slice(0, -5).every((r) => r.y !== null && r.fwdRet !== null));
  check("no feature is NaN", rows.every((r) => r.x.every((v) => Number.isFinite(v))));

  // The lookahead test. Change every bar AFTER row k and the features of row k
  // must not move by a single bit. If they do, the model is reading the future.
  const k = 200;
  const cutDate = rows[k].date;
  const tampered = bars.map((b) => (b.date > cutDate ? { ...b, close: b.close * 3, volume: b.volume * 7 } : b));
  const tamperedIdx = index.map((b) => (b.date > cutDate ? { ...b, close: b.close * 0.5 } : b));
  const rows2 = buildFeatures(tampered, tamperedIdx, 5);
  const same = rows2[k].x.every((v, i) => v === rows[k].x[i]);
  check("features at day k ignore everything after day k", same, same ? "" : rows2[k].x.map((v, i) => (v !== rows[k].x[i] ? FEATURE_NAMES[i] : "")).filter(Boolean).join(","));
  check("but the target at day k does change, because it IS the future", rows2[k].fwdRet !== rows[k].fwdRet);
  // A day's own close must not leak either: the target compares day k+5 to day k.
  const fwd = Math.log(bars[k + 250 + 5].close / bars[k + 250].close);
  check("the forward return is measured from day k to day k+horizon", Math.abs((rows[k].fwdRet ?? 0) - fwd) < 1e-12);

  const t = readTrend(bars);
  check("trend read produces a label", t != null && ["UPTREND", "RECOVERING", "WEAKENING", "DOWNTREND", "SIDEWAYS"].includes(t.label), t?.label);
  check("trend read needs history", readTrend(bars.slice(0, 100)) === null);
}

// ------------------------------------------------------------------- mlp
{
  // A planted linear rule: up when the first feature is positive.
  const X: number[][] = [], Y: number[] = [];
  for (let i = 0; i < 600; i++) { const x = Array.from({ length: 5 }, () => gauss()); X.push(x); Y.push(x[0] > 0 ? 1 : 0); }
  const logit = trainMlp(X, Y, { hidden: [], epochs: 60, seed: 1 });
  const acc = (m: any) => X.filter((x, i) => (predictMlp(m, x) > 0.5 ? 1 : 0) === Y[i]).length / X.length;
  check("logistic regression learns a linear rule", acc(logit) > 0.93, acc(logit).toFixed(3));

  // XOR: a straight line cannot do it, a hidden layer can. This is the one
  // thing that justifies having hidden layers at all.
  const Xx: number[][] = [], Yx: number[] = [];
  for (let i = 0; i < 800; i++) { const a = gauss(), b = gauss(); Xx.push([a, b, gauss() * 0.1]); Yx.push(a * b > 0 ? 1 : 0); }
  const lin = trainMlp(Xx, Yx, { hidden: [], epochs: 60, seed: 2 });
  const net = trainMlp(Xx, Yx, { hidden: [16, 8], epochs: 200, lr: 0.03, seed: 2 });
  const accX = (m: any) => Xx.filter((x, i) => (predictMlp(m, x) > 0.5 ? 1 : 0) === Yx[i]).length / Xx.length;
  check("a line cannot learn XOR", accX(lin) < 0.65, accX(lin).toFixed(3));
  check("the network can", accX(net) > 0.85, accX(net).toFixed(3));
  check("predictions are probabilities", Xx.every((x) => { const p = predictMlp(net, x); return p >= 0 && p <= 1; }));
  check("the same seed gives the same model", predictMlp(trainMlp(X, Y, { hidden: [4], epochs: 20, seed: 9 }), X[0]) === predictMlp(trainMlp(X, Y, { hidden: [4], epochs: 20, seed: 9 }), X[0]));
}

// ------------------------------------------------------------ walk-forward
{
  const opts = { ...DEFAULT_WALK, minTrain: 300, step: 50, train: { ...DEFAULT_WALK.train, epochs: 60 } };

  // Pure noise. The only honest answer is "no skill", and a harness that finds
  // skill here is leaking the future somewhere.
  const index = randomWalk(1100, 0.0003, 0.01, 40000);
  const noise = randomWalk(1100, 0.0003, 0.02, 100);
  const wfNoise = walkForward(buildFeatures(noise, index, 5), opts)!;
  check("walk-forward runs on noise", wfNoise != null && wfNoise.n > 300, wfNoise?.n);
  check("on noise, skill is about zero", Math.abs(wfNoise.skill) < 5, wfNoise.skill.toFixed(2));
  check("on noise, the naive baseline is reported", wfNoise.naiveBest >= 0.5, wfNoise.naiveBest.toFixed(3));
  check("skill is accuracy minus the naive baseline", Math.abs(wfNoise.skill - (wfNoise.accuracy - wfNoise.naiveBest) * 100) < 1e-9);
  check("trades are non-overlapping", wfNoise.rule.trades <= Math.ceil(wfNoise.n / 5));

  // A planted signal: the next five days follow the last five, strongly. A
  // model that cannot find THIS is broken; one that finds it proves the harness
  // can see skill when skill exists.
  const dates = weekdays(1100);
  const planted: EodBar[] = [];
  let p = 100;
  const rets: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    // Momentum block: each five-day block continues the previous block's sign.
    const block = Math.floor(i / 5);
    const prevBlockRet = block > 0 ? rets.slice((block - 1) * 5, block * 5).reduce((s, v) => s + v, 0) : 0;
    const sign = block === 0 ? 1 : prevBlockRet >= 0 ? 1 : -1;
    const r = sign * 0.006 + gauss() * 0.004 + (rnd() < 0.08 ? -sign * 0.03 : 0);
    rets.push(r);
    p *= Math.exp(r);
    planted.push({ date: dates[i], close: p, volume: 1e6, vwap: p });
  }
  const wfSignal = walkForward(buildFeatures(planted, index, 5), opts)!;
  check("on a planted signal, the harness finds real skill", wfSignal.skill > 10, wfSignal.skill.toFixed(1));
  check("and the rule beats buy-and-hold there", wfSignal.edgePct > 0, wfSignal.edgePct.toFixed(1));

  // The words under a number never oversell it.
  check("53% with no skill is called a coin toss", describeForecast(0.53, -1.2).includes("coin toss"));
  check("62% with skill is allowed to lean", describeForecast(0.62, 6).includes("leans up") && describeForecast(0.62, 6).includes("some skill"));
  check("negative skill is called what it is", describeForecast(0.7, -4).includes("worse than guessing"));
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
