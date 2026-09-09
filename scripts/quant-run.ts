// Walk the network forward through the real record and print what it knows.
//
//   npx tsx scripts/quant-run.ts [--symbols MEBL,LUCK] [--seeds 3] [--nocache]
//
// Bars are cached under the scratchpad so a re-run does not hammer the PSX
// feed. Two models per symbol: logistic regression (no hidden layer) and the
// small network, because if depth does not beat a straight line there is no
// case for depth. Every number is out of sample.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchEodBars, type EodBar } from "../lib/timeseries/psx-eod";
import { buildFeatures, readTrend } from "../lib/quant/features";
import { walkForward, latestForecast, DEFAULT_WALK, type WalkOptions, type WalkResult } from "../lib/quant/walkforward";
import { predictMlp, trainMlp } from "../lib/quant/mlp";

const CACHE = process.env.QUANT_CACHE || join(process.env.TEMP || process.env.TMP || ".", "psx-quant-cache");
const argOf = (n: string) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const HOLDINGS = ["AHCL", "HINOON", "HUBC", "INDU", "LUCK", "MARI", "MEBL", "MUREB", "PPL", "PTL"];
const INDICES = ["KSE100", "KMI30", "KSE30"];
const symbols = (argOf("symbols")?.split(",") ?? [...INDICES, ...HOLDINGS]).map((s) => s.trim().toUpperCase());
const seeds = Number(argOf("seeds") ?? 1);
const noCache = process.argv.includes("--nocache");

async function bars(sym: string): Promise<EodBar[]> {
  mkdirSync(CACHE, { recursive: true });
  const f = join(CACHE, sym + ".json");
  if (!noCache && existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const b = await fetchEodBars(sym);
  if (b.length > 0) writeFileSync(f, JSON.stringify(b));
  return b;
}

const pct = (v: number, d = 1) => (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

// Average several seeds' probabilities. Cuts the variance of a small net a lot
// and is the one "make it better" lever that does not risk overfitting.
function ensembleWalk(rows: ReturnType<typeof buildFeatures>, base: WalkOptions, k: number): WalkResult | null {
  if (k <= 1) return walkForward(rows, base);
  const runs: WalkResult[] = [];
  for (let s = 0; s < k; s++) {
    const r = walkForward(rows, { ...base, train: { ...base.train, seed: 7 + s * 101 } });
    if (r) runs.push(r);
  }
  if (runs.length === 0) return null;
  // Same dates in the same order in every run, so average p pointwise.
  const first = runs[0];
  const points = first.points.map((p, i) => ({ ...p, p: runs.reduce((s, r) => s + r.points[i].p, 0) / runs.length }));
  return rescore(points, base, first.windows);
}

// Re-derive the summary from a set of points (used for ensembles).
function rescore(points: WalkResult["points"], opts: WalkOptions, windows: number): WalkResult {
  const n = points.length;
  const baselineUp = points.filter((q) => q.y === 1).length / n;
  const naiveBest = Math.max(baselineUp, 1 - baselineUp);
  const accuracy = points.filter((q) => (q.p > 0.5 ? 1 : 0) === q.y).length / n;
  const brier = points.reduce((s, q) => s + (q.p - q.y) ** 2, 0) / n;
  const brierNaive = points.reduce((s, q) => s + (baselineUp - q.y) ** 2, 0) / n;
  const conf = points.filter((q) => q.p > opts.threshold || q.p < 1 - opts.threshold);
  const confidentAccuracy = conf.length ? conf.filter((q) => (q.p > 0.5 ? 1 : 0) === q.y).length / conf.length : 0;
  const dailyCash = Math.log(1 + opts.cashYieldPct / 100) / 252;
  let rule = 0, hold = 0, trades = 0, hits = 0, inDays = 0, total = 0;
  for (let i = 0; i < n; i += opts.horizon) {
    const q = points[i];
    hold += q.fwdRet; total += opts.horizon;
    if (q.p > opts.threshold) { rule += q.fwdRet; trades++; inDays += opts.horizon; if (q.fwdRet > 0) hits++; }
    else rule += dailyCash * opts.horizon;
  }
  return {
    n, windows, accuracy, baselineUp, naiveBest, skill: (accuracy - naiveBest) * 100, brier, brierNaive,
    confidentAccuracy, confidentShare: conf.length / n,
    rule: { totalRetPct: (Math.exp(rule) - 1) * 100, trades, hitRate: trades ? hits / trades : 0, timeInPct: total ? (inDays / total) * 100 : 0 },
    buyHold: { totalRetPct: (Math.exp(hold) - 1) * 100 },
    edgePct: (Math.exp(rule) - Math.exp(hold)) * 100,
    from: points[0].date, to: points[n - 1].date, points,
  };
}

async function main() {
  const t0 = Date.now();
  const index = await bars("KSE100");
  if (index.length < 300) { console.log("No index history."); process.exit(1); }

  const LOGIT: WalkOptions = { ...DEFAULT_WALK, train: { ...DEFAULT_WALK.train, hidden: [], epochs: 120 } };
  const NET: WalkOptions = DEFAULT_WALK;

  const head =
    pad("symbol", 8) + padL("oos days", 9) + padL("up base", 9) + padL("logit acc", 10) + padL("net acc", 9) +
    padL("skill", 8) + padL("conf acc", 9) + padL("conf%", 7) + padL("brier", 7) + padL("naive", 7) +
    padL("rule", 9) + padL("hold", 9) + padL("edge", 8) + padL("in mkt", 8);
  console.log(head);
  console.log("-".repeat(head.length));

  const summary: Array<{ sym: string; skill: number; edge: number; acc: number; base: number; p?: number; trend?: string }> = [];

  for (const sym of symbols) {
    const b = await bars(sym);
    if (b.length < 400) { console.log(pad(sym, 8) + "  not enough history (" + b.length + ")"); continue; }
    const rows = buildFeatures(b, index, 5);
    const lg = walkForward(rows, LOGIT);
    const nn = ensembleWalk(rows, NET, seeds);
    if (!lg || !nn) { console.log(pad(sym, 8) + "  too few rows after warm-up (" + rows.length + ")"); continue; }
    const fc = latestForecast(rows, NET);
    const trend = readTrend(b);
    summary.push({ sym, skill: nn.skill, edge: nn.edgePct, acc: nn.accuracy, base: nn.baselineUp, p: fc?.p, trend: trend?.label });
    console.log(
      pad(sym, 8) + padL(String(nn.n), 9) + padL((nn.baselineUp * 100).toFixed(1) + "%", 9) +
      padL((lg.accuracy * 100).toFixed(1) + "%", 10) + padL((nn.accuracy * 100).toFixed(1) + "%", 9) +
      padL(pct(nn.skill), 8) + padL((nn.confidentAccuracy * 100).toFixed(1) + "%", 9) + padL((nn.confidentShare * 100).toFixed(0) + "%", 7) +
      padL(nn.brier.toFixed(3), 7) + padL(nn.brierNaive.toFixed(3), 7) +
      padL(pct(nn.rule.totalRetPct, 0), 9) + padL(pct(nn.buyHold.totalRetPct, 0), 9) + padL(pct(nn.edgePct, 0), 8) +
      padL(nn.rule.timeInPct.toFixed(0) + "%", 8)
    );
  }

  console.log("");
  const withSkill = summary.filter((s) => Number.isFinite(s.skill));
  const meanSkill = withSkill.reduce((s, x) => s + x.skill, 0) / Math.max(1, withSkill.length);
  const meanAcc = withSkill.reduce((s, x) => s + x.acc, 0) / Math.max(1, withSkill.length);
  const meanBase = withSkill.reduce((s, x) => s + Math.max(x.base, 1 - x.base), 0) / Math.max(1, withSkill.length);
  const beatHold = withSkill.filter((s) => s.edge > 0).length;
  console.log(`Across ${withSkill.length} symbols: mean accuracy ${(meanAcc * 100).toFixed(1)}% against a mean naive baseline of ${(meanBase * 100).toFixed(1)}%.`);
  console.log(`Mean skill ${pct(meanSkill)} points. The trading rule beat buy-and-hold on ${beatHold} of ${withSkill.length}.`);
  console.log(`Seeds per model: ${seeds}. Out-of-sample throughout: every prediction was made by a model that had not seen that day.`);
  console.log("\nLatest forecasts (train on everything, predict tomorrow's 5-day direction):");
  for (const s of summary) {
    if (s.p == null) continue;
    console.log(`  ${pad(s.sym, 8)} p(up) ${(s.p * 100).toFixed(0)}%   trend ${s.trend ?? "-"}   skill ${pct(s.skill)}`);
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
