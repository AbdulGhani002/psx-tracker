// The quant stack has to prove it is honest before its numbers mean anything.
//
// The important tests here are the ones about the HARNESS, not the models:
// that features never see the future, that the walk-forward reports zero on
// pure noise, and that it reports strong skill when a signal is planted. If
// those hold, then a zero on real data is a fact about the market and not a
// bug in the code.
//
//   npx tsx scripts/test-quant.ts

import { Raster, INK, PAPER } from "../lib/charts/raster";
import { renderPriceChart, sma } from "../lib/charts/price-chart";
import { buildFeatures, readTrend, FEATURE_NAMES, TARGET_NAMES, DIP_PCT } from "../lib/quant/features";
import { trainMlp, predictMlp, predictMlpAll, mulberry32 } from "../lib/quant/mlp";
import { trainGbm, predictGbm, trainGbmMulti, gbmFeatureUse } from "../lib/quant/gbm";
import { walkForward, describeForecast, DEFAULT_WALK } from "../lib/quant/walkforward";
import { buildPanel, walkForwardPanel, auc, spearman, describeAuc, predictEnsemble, trainEnsemble, DEFAULT_PANEL, type PanelOptions } from "../lib/quant/panel";
import { marketContext, MARKET_CONTEXT_NAMES } from "../lib/quant/context";
import { despike } from "../lib/timeseries/macro";
import { probit, projectLevels, modelBands } from "../lib/quant/projection";
import { RANK_FEATURE_NAMES, RANK_SOURCE } from "../lib/quant/features";
import { readMarket, readName, standingOf } from "../lib/quant/analysis";
import { membership, equalWeightIndex } from "../lib/quant/archive";
import { strategyBacktest, indexGate } from "../lib/quant/strategy";
import type { PanelPoint } from "../lib/quant/panel";
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
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  let off = 8, chunks = 0, crcOk = true;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const body = png.subarray(off + 4, off + 8 + len);
    if (crc(body) !== png.readUInt32BE(off + 8 + len)) crcOk = false;
    chunks++;
    off += 12 + len;
  }
  check("png has three chunks with good CRCs", chunks === 3 && crcOk, chunks);
  const bars = randomWalk(300);
  const closes = bars.map((b) => b.close);
  const chart = renderPriceChart({ title: "TEST", bars, ma50: sma(closes, 50), ma200: sma(closes, 200), buyZone: { low: 90, high: 100 }, avgCost: 95 });
  check("a full chart renders to a real png", chart.length > 5000 && chart.readUInt32BE(16) === 1200, chart.length);
  check("an empty series still renders rather than throwing", renderPriceChart({ title: "EMPTY", bars: [] }).length > 1000);
}

// -------------------------------------------------------------- features
{
  const index = randomWalk(700, 0.0004, 0.01, 40000);
  const bars = randomWalk(700, 0.0003, 0.02, 100);
  const rows = buildFeatures(bars, index, 5);
  check("features start after the 250-day warm-up", rows.length === 700 - 250, rows.length);
  check("every row has the full feature vector", rows.every((r) => r.x.length === FEATURE_NAMES.length), FEATURE_NAMES.length);
  check("the last five rows have no target", rows.slice(-5).every((r) => r.y === null && r.fwdRet === null && r.targets === null));
  check("earlier rows have all three targets", rows.slice(0, -5).every((r) => r.targets?.length === TARGET_NAMES.length && r.fwdRel != null));
  check("no feature is NaN", rows.every((r) => r.x.every((v) => Number.isFinite(v))));

  // The lookahead test. Change every bar AFTER row k and the features of row k
  // must not move by a single bit. If they do, the model is reading the future.
  // The market context is rebuilt from the tampered bars too, so it is tested
  // for lookahead by the same move.
  const others = new Map<string, EodBar[]>();
  for (let s = 0; s < 12; s++) others.set("S" + s, randomWalk(700, 0.0002, 0.02, 50 + s));
  const ctx = marketContext(others, index);
  const rowsCtx = buildFeatures(bars, index, 5, ctx);
  check("context widens the feature vector", rowsCtx.every((r) => r.x.length === FEATURE_NAMES.length + MARKET_CONTEXT_NAMES.length));
  const k = 200;
  const cutDate = rows[k].date;
  const tamper = (b: EodBar[], f: number) => b.map((x) => (x.date > cutDate ? { ...x, close: x.close * f, volume: x.volume * 7 } : x));
  const tamperedOthers = new Map([...others].map(([s, b]) => [s, tamper(b, 2 + (s.length % 3))]));
  const rows2 = buildFeatures(tamper(bars, 3), tamper(index, 0.5), 5, marketContext(tamperedOthers, tamper(index, 0.5)));
  const same = rows2[k].x.every((v, i) => v === rowsCtx[k].x[i]);
  const names = [...FEATURE_NAMES, ...MARKET_CONTEXT_NAMES];
  check("features at day k ignore everything after day k", same, same ? "" : rows2[k].x.map((v, i) => (v !== rowsCtx[k].x[i] ? names[i] : "")).filter(Boolean).join(","));
  check("but the target at day k does change, because it IS the future", rows2[k].fwdRet !== rows[k].fwdRet);
  const fwd = Math.log(bars[k + 250 + 5].close / bars[k + 250].close);
  check("the forward return is measured from day k to day k+horizon", Math.abs((rows[k].fwdRet ?? 0) - fwd) < 1e-12);

  // Dip target: a series that drops 6% on the day after k and recovers.
  const dipBars = randomWalk(400, 0, 0.001, 100);
  const j = 300;
  const dipped = dipBars.map((b, i) => (i === j + 2 ? { ...b, close: dipBars[j].close * (1 - (DIP_PCT + 1) / 100) } : b));
  const dipRows = buildFeatures(dipped, randomWalk(400, 0, 0.001, 40000), 5);
  const at = dipRows.find((r) => r.date === dipped[j].date)!;
  const before = dipRows.find((r) => r.date === dipped[j - 10].date)!;
  check("a 6% drop inside the horizon sets the dip target", at.targets![2] === 1);
  check("and a window without one does not", before.targets![2] === 0);

  const t = readTrend(bars);
  check("trend read produces a label", t != null && ["UPTREND", "RECOVERING", "WEAKENING", "DOWNTREND", "SIDEWAYS"].includes(t.label), t?.label);
  check("trend read needs history", readTrend(bars.slice(0, 100)) === null);
}

// ------------------------------------------------------------- context
{
  // Twelve names all rising steadily: everything above its averages.
  const up = new Map<string, EodBar[]>();
  for (let s = 0; s < 12; s++) up.set("U" + s, weekdays(300).map((date, i) => ({ date, close: 100 * Math.exp(0.002 * i), volume: 1e6, vwap: 100 })));
  const idx = weekdays(300).map((date, i) => ({ date, close: 40000 * Math.exp(0.002 * i), volume: 0, vwap: 0 }));
  const ctx = marketContext(up, idx);
  const last = ctx.get(weekdays(300)[299])!;
  check("breadth is 100% above the 50-day when every name rises", Math.abs(last[0] - 0.5) < 1e-9, last[0]);
  check("breadth is 100% above the 200-day too", Math.abs(last[1] - 0.5) < 1e-9, last[1]);
  check("every name is up over 20 sessions", Math.abs(last[2] - 0.5) < 1e-9, last[2]);
  check("identical names have zero dispersion", Math.abs(last[3]) < 1e-9, last[3]);
  const early = ctx.get(weekdays(300)[5])!;
  check("too few names with history leaves the context neutral", early.every((v) => v === 0));

  const spiky: EodBar[] = weekdays(50).map((date, i) => ({ date, close: i === 25 ? 400 : 200 + i * 0.1, volume: 0, vwap: 0 }));
  check("a one-day bad tick is dropped", despike(spiky).length === 49);
  const stepped: EodBar[] = weekdays(50).map((date, i) => ({ date, close: i >= 25 ? 260 : 200, volume: 0, vwap: 0 }));
  check("a real step change is kept", despike(stepped).length === 50);
}

// ------------------------------------------------------------------- mlp
{
  const X: number[][] = [], Y: number[] = [];
  for (let i = 0; i < 600; i++) { const x = Array.from({ length: 5 }, () => gauss()); X.push(x); Y.push(x[0] > 0 ? 1 : 0); }
  const acc = (m: any) => X.filter((x, i) => (predictMlp(m, x) > 0.5 ? 1 : 0) === Y[i]).length / X.length;
  const logit = trainMlp(X, Y, { hidden: [], epochs: 60, seed: 1 });
  check("logistic regression learns a linear rule", acc(logit) > 0.93, acc(logit).toFixed(3));

  const Xx: number[][] = [], Yx: number[] = [];
  for (let i = 0; i < 800; i++) { const a = gauss(), b = gauss(); Xx.push([a, b, gauss() * 0.1]); Yx.push(a * b > 0 ? 1 : 0); }
  const lin = trainMlp(Xx, Yx, { hidden: [], epochs: 60, seed: 2 });
  const net = trainMlp(Xx, Yx, { hidden: [16, 8], epochs: 200, seed: 2 });
  const accX = (m: any) => Xx.filter((x, i) => (predictMlp(m, x) > 0.5 ? 1 : 0) === Yx[i]).length / Xx.length;
  check("a line cannot learn XOR", accX(lin) < 0.65, accX(lin).toFixed(3));
  check("the network can", accX(net) > 0.85, accX(net).toFixed(3));
  check("predictions are probabilities", Xx.every((x) => { const p = predictMlp(net, x); return p >= 0 && p <= 1; }));
  check("the same seed gives the same model", predictMlp(trainMlp(X, Y, { hidden: [4], epochs: 20, seed: 9 }), X[0]) === predictMlp(trainMlp(X, Y, { hidden: [4], epochs: 20, seed: 9 }), X[0]));

  // Two outputs, two different rules, one network.
  const Y2 = Xx.map((x, i) => [Yx[i], x[0] > 0 ? 1 : 0]);
  const multi = trainMlp(Xx, Y2, { hidden: [16, 8], epochs: 200, seed: 3 });
  const acc2 = (o: number) => Xx.filter((x, i) => (predictMlpAll(multi, x)[o] > 0.5 ? 1 : 0) === Y2[i][o]).length / Xx.length;
  check("a multi-output network learns XOR on output 0", acc2(0) > 0.85, acc2(0).toFixed(3));
  check("and the linear rule on output 1", acc2(1) > 0.93, acc2(1).toFixed(3));
  const thawed = JSON.parse(JSON.stringify(multi));
  check("a network survives a JSON round trip", predictMlpAll(thawed, Xx[5]).every((v, o) => v === predictMlpAll(multi, Xx[5])[o]));
}

// ------------------------------------------------------------------- gbm
{
  const X: number[][] = [], Y: number[] = [];
  for (let i = 0; i < 1500; i++) { const x = Array.from({ length: 6 }, () => gauss()); X.push(x); Y.push(x[0] + 0.5 * x[1] > 0 ? 1 : 0); }
  const m = trainGbm(X, Y, { rounds: 200, seed: 1 });
  const acc = X.filter((x, i) => (predictGbm(m, x) > 0.5 ? 1 : 0) === Y[i]).length / X.length;
  check("boosted trees learn a linear rule", acc > 0.9, acc.toFixed(3));
  check("early stopping keeps the round count finite", m.rounds > 0 && m.rounds <= 200, m.rounds);

  const Xx: number[][] = [], Yx: number[] = [];
  for (let i = 0; i < 1500; i++) { const a = gauss(), b = gauss(); Xx.push([a, b, gauss()]); Yx.push(a * b > 0 ? 1 : 0); }
  const mx = trainGbm(Xx, Yx, { rounds: 300, maxDepth: 3, minLeaf: 20, seed: 2 });
  const accX = Xx.filter((x, i) => (predictGbm(mx, x) > 0.5 ? 1 : 0) === Yx[i]).length / Xx.length;
  check("boosted trees learn XOR", accX > 0.85, accX.toFixed(3));
  check("tree probabilities stay in range", Xx.every((x) => { const p = predictGbm(mx, x); return p >= 0 && p <= 1; }));
  const thawed = JSON.parse(JSON.stringify(mx));
  check("a booster survives a JSON round trip", predictGbm(thawed, Xx[7]) === predictGbm(mx, Xx[7]));
  check("the same seed gives the same booster", predictGbm(trainGbm(X, Y, { rounds: 30, seed: 5 }), X[3]) === predictGbm(trainGbm(X, Y, { rounds: 30, seed: 5 }), X[3]));

  const fixed = trainGbm(X, Y, { rounds: 25, earlyStop: false, seed: 1 });
  check("without early stopping a booster keeps every round", fixed.rounds === 25 && fixed.trees.length === 25, fixed.rounds);
  const Y2 = Xx.map((x, i) => [Yx[i], x[2] > 0 ? 1 : 0]);
  const both = trainGbmMulti(Xx, Y2, { rounds: 200, maxDepth: 3, minLeaf: 20, seed: 4 });
  const sized = trainGbmMulti(Xx, Y2, { rounds: 200, maxDepth: 3, minLeaf: 20, seed: 4 }, [12, 7]);
  check("per-target round counts are honoured", sized[0].rounds === 12 && sized[1].rounds === 7, sized.map((m) => m.rounds).join("/"));
  const use = gbmFeatureUse(both);
  check("one booster per target", both.length === 2);
  check("feature use sums to one", Math.abs(use.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  check("the second booster leans on the feature that drives its target", use[2] > 0.2, use.map((v) => v.toFixed(2)).join(","));
}

// -------------------------------------------------------------- statistics
{
  const perfect = Array.from({ length: 50 }, (_, i) => ({ p: i / 50, y: i >= 25 ? 1 : 0 }));
  check("AUC of a perfect ranking is 1", auc(perfect) === 1);
  check("AUC of a reversed ranking is 0", auc(perfect.map((q) => ({ ...q, p: 1 - q.p }))) === 0);
  const noise = Array.from({ length: 4000 }, () => ({ p: rnd(), y: rnd() < 0.6 ? 1 : 0 }));
  check("AUC of noise is about a half", Math.abs(auc(noise) - 0.5) < 0.03, auc(noise).toFixed(3));
  check("AUC with all ties is a half", auc(Array.from({ length: 20 }, (_, i) => ({ p: 0.5, y: i % 2 }))) === 0.5);
  check("spearman of a monotone map is 1", Math.abs(spearman([1, 2, 3, 4, 5], [10, 20, 40, 80, 160]) - 1) < 1e-12);
  check("spearman of a reversed map is -1", Math.abs(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) + 1) < 1e-12);
  check("AUC words never oversell", describeAuc(0.51) === "coin toss" && describeAuc(0.45) === "worse than a coin toss" && describeAuc(0.66) === "clear skill");
}

// ------------------------------------------------------------ projection
{
  check("probit inverts the normal curve", Math.abs(probit(0.5)) < 1e-9 && Math.abs(probit(0.975) - 1.959964) < 1e-4 && Math.abs(probit(0.1) + 1.281552) < 1e-4);
  const bars = randomWalk(400, 0.0003, 0.015, 100);
  const flat = projectLevels(bars, 20, 0.5, 0.3)!;
  const bull = projectLevels(bars, 20, 0.65, 0.3)!;
  const bear = projectLevels(bars, 20, 0.35, 0.3)!;
  const last = bars[bars.length - 1].close;
  check("even odds put the centre on today's price", Math.abs(flat.median - last) < 1e-9);
  check("higher odds lift the centre, lower odds drop it", bull.median > last && bear.median < last);
  check("the range brackets the centre one deviation each way", flat.low < flat.median && flat.median < flat.high && Math.abs(Math.log(flat.high / flat.median) - flat.sigmaH) < 1e-9);
  check("the tilt is capped at half a deviation", Math.abs(Math.log(projectLevels(bars, 20, 0.99, 0.3)!.median / last)) <= 0.5 * flat.sigmaH + 1e-9);
  check("the dip level is 5% under today", Math.abs(flat.dipLevel - last * 0.95) < 1e-9);
  check("the range widens with the horizon", projectLevels(bars, 60, 0.5, 0.3)!.high > flat.high);
  const b = modelBands(flat);
  check("model bands sit in order: buy below, sell above", b.buyLow < b.buyHigh && b.buyHigh < flat.median && flat.median < b.sellLow && b.sellLow < b.sellHigh);
  check("projection needs a year of history", projectLevels(bars.slice(0, 200), 20, 0.5, 0.3) === null);
}

// ------------------------------------------------------------ ranks
{
  const index = randomWalk(400, 0.0004, 0.01, 40000);
  const names = new Map<string, EodBar[]>();
  for (let s = 0; s < 12; s++) names.set("R" + s, randomWalk(400, 0.0002 * s, 0.015, 100));
  const p = buildPanel(names, index, 20, { ranks: true });
  const width = FEATURE_NAMES.length + RANK_FEATURE_NAMES.length;
  check("ranks widen the feature vector", p.rows.every((r) => r.x.length === width), width);
  const lastDi = p.dates.length - 1;
  const day = p.rows.filter((r) => r.di === lastDi);
  const c = RANK_SOURCE[0], rk = FEATURE_NAMES.length;
  const sorted = [...day].sort((a, b) => a.x[c] - b.x[c]);
  check("the lowest name ranks -0.5 and the highest +0.5", Math.abs(sorted[0].x[rk] + 0.5) < 1e-9 && Math.abs(sorted[sorted.length - 1].x[rk] - 0.5) < 1e-9);
  check("ranks are monotone in the feature they rank", sorted.every((r, i) => i === 0 || r.x[rk] >= sorted[i - 1].x[rk]));
  // Tamper with the future and the ranks of an earlier day must not move.
  const cut = p.dates[100];
  const tampered = new Map([...names].map(([s, b]) => [s, b.map((x) => (x.date > cut ? { ...x, close: x.close * 2 } : x))]));
  const p2 = buildPanel(tampered, index, 20, { ranks: true });
  const before = p.rows.filter((r) => r.date === cut).map((r) => r.x.slice(rk).join(","));
  const after = p2.rows.filter((r) => r.date === cut).map((r) => r.x.slice(rk).join(","));
  check("ranks at day k ignore everything after day k", before.length > 0 && before.join("|") === after.join("|"));
}

// ------------------------------------------------------------ analysis
{
  check("market is strong above the 200-day with broad breadth", readMarket(true, 100, 95, 55, 60).state === "STRONG");
  check("market is mixed above the 200-day with thin breadth", readMarket(true, 100, 95, 30, 40).state === "MIXED");
  check("market is weak below the 200-day whatever the breadth", readMarket(false, 90, 95, 70, 70).state === "WEAK");
  check("standing splits the ranking into fifths", standingOf(0.9) === "STRONG" && standingOf(0.5) === "MIDDLE" && standingOf(0.1) === "WEAK" && standingOf(null) === "MIDDLE");

  const bars = randomWalk(400, 0.0005, 0.012, 100);
  const proj = projectLevels(bars, 20, 0.6, 0.3)!;
  const bands = modelBands(proj);
  const price = bars[bars.length - 1].close;
  const up = { above50: true, above200: true, goldenCross: true, ma200Rising: true, offHighPct: -2, ret20Pct: 3, label: "UPTREND" as const, line: "", short: "" };
  const down = { ...up, above50: false, above200: false, goldenCross: false, label: "DOWNTREND" as const };
  const base = { held: true, market: "STRONG" as const, trend: up, price, projection: proj, bands, pDip: 0.3, dipUsable: true };

  check("a strong name in a strong market with the trend intact is a BUY", readName({ ...base, pctile: 0.9 }).verdict === "BUY");
  check("with high dip odds the buy is staged instead", readName({ ...base, pctile: 0.9, pDip: 0.6 }).verdict === "STAGE");
  check("but not when the dip record is too weak to use", readName({ ...base, pctile: 0.9, pDip: 0.6, dipUsable: false }).verdict === "BUY");
  check("a strong name still falling is a WATCH with a trigger", (() => { const r = readName({ ...base, pctile: 0.9, trend: down }); return r.verdict === "WATCH" && r.zone.trigger != null; })());
  check("a strong name in a weak market is held, not bought", readName({ ...base, pctile: 0.9, market: "WEAK" }).verdict === "HOLD");
  check("and not bought new either", readName({ ...base, pctile: 0.9, market: "WEAK", held: false }).verdict === "WAIT");
  check("a weak name held in a weak market is a SELL", readName({ ...base, pctile: 0.1, market: "WEAK" }).verdict === "SELL");
  check("a weak name held in a strong market is a TRIM", readName({ ...base, pctile: 0.1 }).verdict === "TRIM");
  check("a weak name not held is AVOID", readName({ ...base, pctile: 0.1, held: false }).verdict === "AVOID");
  check("a middling name held is HOLD, not held is PASS", readName({ ...base, pctile: 0.5 }).verdict === "HOLD" && readName({ ...base, pctile: 0.5, held: false }).verdict === "PASS");
  const z = readName({ ...base, pctile: 0.9 }).zone;
  check("the model zone sits in order around the price", z.buyLow < z.buyHigh && z.sellLow < z.sellHigh && z.buyHigh < z.sellLow && z.fails <= price);
}

// ------------------------------------------------------------ archive
{
  const dates = weekdays(520, "2020-01-06");
  const mk = (level: number, vol: number, drift = 0) => dates.map((date, i) => ({ date, close: level * Math.exp(drift * i), volume: vol, vwap: level }));
  const bars = new Map<string, EodBar[]>([
    ["BIG", mk(100, 1e6)],
    ["MID", mk(50, 5e5)],
    ["SMALL", mk(10, 1e4)],
  ]);
  const m = membership(bars, 2);
  check("membership takes the most traded names of the previous year", m.get(2021)?.has("BIG") === true && m.get(2021)?.has("MID") === true && m.get(2021)?.has("SMALL") === false);
  check("the first year has no membership (nothing came before it)", !m.has(2020));
  const rising = new Map<string, EodBar[]>([["A", mk(100, 1, 0.001)], ["B", mk(20, 1, 0.001)]]);
  const ew = equalWeightIndex(rising, null, 2);
  check("the equal-weight index chains the mean daily log return", ew.length === dates.length - 1 && Math.abs(Math.log(ew[ew.length - 1].close / ew[0].close) - 0.001 * (dates.length - 2)) < 1e-9);
}

// ------------------------------------------------------------ strategy
{
  // Thirty names, twenty rebalances; the model's odds are informative by
  // construction: forward return = 0.02 * (p - 0.5) + noise.
  const rnd2 = mulberry32(99);
  const dates = weekdays(20 * 20 + 1, "2022-01-03");
  const points: PanelPoint[] = [];
  const index: EodBar[] = dates.map((date, i) => ({ date, close: 100 * Math.exp(0.0005 * i), volume: 0, vwap: 0 }));
  for (let di = 0; di < dates.length; di++) {
    for (let s = 0; s < 30; s++) {
      const p = rnd2();
      const fwd = 0.02 * (p - 0.5) + 0.01 * (rnd2() - 0.5);
      points.push({ symbol: "S" + s, date: dates[di], di, p: [0.5, p, 0.3], t: [fwd > 0 ? 1 : 0, 1, 0], fwdRet: fwd, fwdRel: fwd });
    }
  }
  const r = strategyBacktest(points, index, null, { horizon: 20, cashYieldPct: 10, costPct: 0 })!;
  check("the rule test runs one period per horizon", r.rebalances === 21, r.rebalances);
  const legs = Object.fromEntries(r.legs.map((l) => [l.name, l]));
  check("the top fifth beats the universe when the odds are informative", legs["model top fifth, always in"].cagrPct > legs["universe, buy and hold"].cagrPct);
  check("the bottom fifth trails it", legs["model bottom fifth (what it says to avoid)"].cagrPct < legs["universe, buy and hold"].cagrPct);
  const costed = strategyBacktest(points, index, null, { horizon: 20, cashYieldPct: 10, costPct: 1 })!;
  check("costs lower the model legs and leave buy-and-hold alone", costed.legs[1].cagrPct < r.legs[1].cagrPct && Math.abs(costed.legs[0].cagrPct - r.legs[0].cagrPct) < 1e-9);
  const gate = indexGate(index);
  check("a rising index is above its 200-day once it has one", gate.get(dates[250]) === true && !gate.has(dates[100]));
  const falling: EodBar[] = dates.map((date, i) => ({ date, close: 100 * Math.exp(-0.002 * i), volume: 0, vwap: 0 }));
  const shut = strategyBacktest(points, falling, null, { horizon: 20, cashYieldPct: 10, costPct: 0 })!;
  check("with the gate shut the gated leg earns the cash rate", Math.abs(shut.legs[3].cagrPct - 10) < 0.5 && shut.legs[3].inMarketPct === 0, shut.legs[3].cagrPct.toFixed(2));
}

// ------------------------------------------------------------ walk-forward
{
  const opts = { ...DEFAULT_WALK, minTrain: 300, step: 50, train: { ...DEFAULT_WALK.train, epochs: 60 } };
  const index = randomWalk(1100, 0.0003, 0.01, 40000);
  const noise = randomWalk(1100, 0.0003, 0.02, 100);
  const wfNoise = walkForward(buildFeatures(noise, index, 5), opts)!;
  check("single-name walk-forward runs on noise", wfNoise != null && wfNoise.n > 300, wfNoise?.n);
  check("on noise, skill is about zero", Math.abs(wfNoise.skill) < 5, wfNoise.skill.toFixed(2));
  check("skill is accuracy minus the naive baseline", Math.abs(wfNoise.skill - (wfNoise.accuracy - wfNoise.naiveBest) * 100) < 1e-9);
  check("trades are non-overlapping", wfNoise.rule.trades <= Math.ceil(wfNoise.n / 5));

  const dates = weekdays(1100);
  const planted: EodBar[] = [];
  let p = 100;
  const rets: number[] = [];
  for (let i = 0; i < dates.length; i++) {
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
  check("53% with no skill is called a coin toss", describeForecast(0.53, -1.2).includes("coin toss"));
  check("negative skill is called what it is", describeForecast(0.7, -4).includes("worse than guessing"));
}

// ---------------------------------------------------------------- panel
{
  const popts: PanelOptions = { ...DEFAULT_PANEL, learner: "both", minTrain: 400, step: 150, horizon: 20, seeds: 1, train: { ...DEFAULT_PANEL.train, epochs: 40 }, gbm: { ...DEFAULT_PANEL.gbm, rounds: 120, minLeaf: 30 } };
  const N = 1000;
  const index = randomWalk(N, 0.0003, 0.01, 40000);

  // Pooled noise, twice, because each target has a clean null in a different
  // world. Sixteen unrelated random walks share nothing, so "up" must be a
  // coin toss there. Sixteen names that are the market plus their own noise
  // share the market's path, which makes "up" a handful of correlated bets
  // per window (too few to test) but leaves "beat" as pure noise.
  const walks = new Map<string, EodBar[]>();
  for (let s = 0; s < 32; s++) walks.set("W" + s, randomWalk(N, 0.0003, 0.02, 100));
  const pw = buildPanel(walks, index, 20, { context: marketContext(walks, index) });
  check("the panel stacks every name", pw.symbols.length === 32 && pw.rows.length === 32 * (N - 250), pw.rows.length);
  check("panel rows are in date order", pw.rows.every((r, i) => i === 0 || r.di >= pw.rows[i - 1].di));
  const ww = walkForwardPanel(pw, popts)!;
  check("pooled walk-forward runs on noise", ww != null && ww.n > 5000, ww?.n);
  check("on unrelated noise, AUC(up) is about a half", Math.abs(ww.targets[0].auc - 0.5) < 0.05, ww.targets[0].auc.toFixed(3));
  check("on unrelated noise, skill is about zero", Math.abs(ww.targets[0].skill) < 5, ww.targets[0].skill.toFixed(2));
  check("per-name records exist for every name", ww.perSymbol.length === 32);

  // One synthetic world is a coin flip of its own: across seeds the rank IC
  // on pure noise scatters about +-0.06 with |t| up to 2.6 on seventeen
  // independent dates. So three worlds are averaged, and the averages are
  // what must sit at zero.
  const nDates = weekdays(N);
  const beatAucs: number[] = [], ics: number[] = [], spreads: number[] = [];
  for (const world of [1, 2, 3]) {
    const wr = mulberry32(world * 7919);
    const wg = () => { const u = wr() || 1e-9, v = wr(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const noise = new Map<string, EodBar[]>();
    for (let s = 0; s < 32; s++) {
      let p = 100;
      const bars: EodBar[] = [];
      for (let i = 0; i < N; i++) {
        const mkt = i > 0 ? Math.log(index[i].close / index[i - 1].close) : 0;
        p *= Math.exp(mkt + 0.0001 + 0.018 * wg());
        bars.push({ date: nDates[i], close: p, volume: 1e6 * (0.5 + wr()), vwap: p });
      }
      noise.set("N" + s, bars);
    }
    const pn = buildPanel(noise, index, 20, { context: marketContext(noise, index) });
    const wn = walkForwardPanel(pn, popts)!;
    beatAucs.push(wn.targets[1].auc);
    ics.push(wn.icRel.mean);
    spreads.push(wn.spread.mean);
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  check("on market-plus-noise, AUC(beat) averages about a half over three worlds", Math.abs(mean(beatAucs) - 0.5) < 0.04, beatAucs.map((v) => v.toFixed(3)).join(" "));
  check("on market-plus-noise, the rank IC averages about zero", Math.abs(mean(ics)) < 0.05, ics.map((v) => v.toFixed(3)).join(" "));
  check("on market-plus-noise, the top fifth does not beat the bottom fifth", Math.abs(mean(spreads)) < 1.2, spreads.map((v) => v.toFixed(2)).join(" ") + "%");

  // A planted cross-sectional signal: each name carries a drift that flips
  // sign every sixty sessions, so its own recent relative return predicts its
  // next relative return. A harness that cannot find THIS is broken.
  const dates = weekdays(N);
  const planted = new Map<string, EodBar[]>();
  for (let s = 0; s < 16; s++) {
    let p = 100;
    let drift = rnd() < 0.5 ? 0.004 : -0.004;
    const bars: EodBar[] = [];
    for (let i = 0; i < N; i++) {
      if (i % 60 === 0 && i > 0 && rnd() < 0.5) drift = -drift;
      p *= Math.exp(drift + 0.012 * gauss() + Math.log(index[i].close / (index[i - 1]?.close ?? index[i].close)));
      bars.push({ date: dates[i], close: p, volume: 1e6, vwap: p });
    }
    planted.set("P" + s, bars);
  }
  const pp = buildPanel(planted, index, 20, { context: marketContext(planted, index) });
  const wp = walkForwardPanel(pp, popts)!;
  check("on a planted cross-sectional signal, AUC(beat) is well above a half", wp.targets[1].auc > 0.6, wp.targets[1].auc.toFixed(3));
  check("and the rank IC is clearly positive", wp.icRel.mean > 0.15, wp.icRel.mean.toFixed(3));
  check("and the top fifth beats the bottom fifth", wp.spread.mean > 1, wp.spread.mean.toFixed(2) + "%");

  // Ensemble plumbing: both kinds, averaged, deterministic, JSON-safe.
  const rows = pp.rows.filter((r) => r.targets).slice(0, 3000);
  const learners = trainEnsemble(rows, { ...popts, train: { ...popts.train, epochs: 10 }, gbm: { ...popts.gbm, rounds: 20 } });
  check("both kinds of learner are trained", learners.some((l) => l.kind === "mlp") && learners.some((l) => l.kind === "gbm"));
  const p1 = predictEnsemble(learners, rows[10].x);
  const p2 = predictEnsemble(JSON.parse(JSON.stringify(learners)), rows[10].x);
  check("the ensemble returns one probability per target", p1.length === TARGET_NAMES.length && p1.every((v) => v >= 0 && v <= 1));
  check("the ensemble survives a JSON round trip", p1.every((v, i) => v === p2[i]));
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
