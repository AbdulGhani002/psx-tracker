// The strategy's model, researched on the exchange's own 24-year archive: the
// monthly panel (lib/macro/panel.ts) built from the archive's bars and cash
// dividends, the SBP policy rate (lib/macro/pk-history.json), inflation and
// growth, and the world series the server keeps (oil, gold, the rupee, US and
// emerging stocks, the dollar, US yields). Each candidate is walked forward a
// year at a time (lib/macro/models.ts) against the same baselines.
//
//   NODE_OPTIONS=--max-old-space-size=8000 npx tsx scripts/macro-lab.ts --archive C:/CC/Data/psx-history --macro C:/CC/Data/macro
//        [--export C:/CC/Data/macro/panel.json] [--from 2008]

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { loadArchive, loadActions, membership, equalWeightIndex } from "../lib/quant/archive";
import { trainGbm, predictGbm } from "../lib/quant/gbm";
import { trainMlp, predictMlp } from "../lib/macro/mlp";
import { macroState, MACRO_NAMES, logChange, valueOn, monthsBack, type MacroInputs, type Point } from "../lib/macro/series";
import { buildPanel, STOCK_NAMES, SECTOR_NAMES, SENS_NAMES, FACTORS, type PanelRow } from "../lib/macro/panel";
import { fitRidge, predictRidge, walkForward, scoreMonths, summarise, type WalkRecord } from "../lib/macro/models";
import { sectorKey } from "../lib/calculations/sector-weights";
import symbols from "../lib/psx-symbols.json";
import history from "../lib/macro/pk-history.json";
import { argOf } from "./quant-cli";

const ARCHIVE = argOf("archive") || "C:/CC/Data/psx-history";
const MACRO = argOf("macro") || "C:/CC/Data/macro";
const FROM = Number(argOf("from") || 2008);
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

// --- inputs ----------------------------------------------------------------
const bars = loadArchive(ARCHIVE);
const members = membership(bars, 120);
const market = equalWeightIndex(bars, members, 10, true);
const actions = loadActions(ARCHIVE, bars.keys());
const dividends = new Map([...actions].map(([s, a]) => [s, a.filter((x) => x.kind === "cash" && x.yieldPct > 0).map((x) => ({ date: x.date, yieldPct: x.yieldPct }))]));
console.log(`${secs()} archive: ${bars.size} names, market ${market[0].date} to ${market[market.length - 1].date}`);

const dump = JSON.parse(gunzipSync(readFileSync(join(MACRO, "macro-dump.json.gz"))).toString()) as { macro: { [k: string]: Point[] }; cpi: Array<{ period: string; index: number }>; fund: Array<{ symbol: string; sector?: string }> };
const sectors = new Map<string, string>();
for (const f of dump.fund) if (f.sector) sectors.set(f.symbol, sectorKey(f.sector));
for (const s of symbols as Array<{ symbol: string; sector: string }>) if (s.sector) sectors.set(s.symbol, sectorKey(s.sector));

const marketPoints: Point[] = market.map((b) => [b.date, b.close]);
const inputs: MacroInputs = {
  policy: history.policy as Point[],
  cpiMonthly: dump.cpi,
  cpiAnnual: history.cpiAnnual as Array<[number, number]>,
  gdpAnnual: history.gdpAnnual as Array<[number, number]>,
  oil: dump.macro.oil,
  gold: dump.macro.gold,
  usdpkr: dump.macro.usdpkr,
  spx: dump.macro.spx,
  em: dump.macro.em,
  dxy: dump.macro.dxy,
  us10y: dump.macro.us10y,
  market: marketPoints,
};

const monthEnds: string[] = [];
for (let i = 0; i < market.length; i++) if (i === market.length - 1 || market[i + 1].date.slice(0, 7) !== market[i].date.slice(0, 7)) monthEnds.push(market[i].date);

type F = (typeof FACTORS)[number];
const move = (date: string, months: number): Record<F, number | null> => ({
  oil: logChange(inputs.oil, date, months, true),
  pkr: logChange(inputs.usdpkr, date, months),
  gold: logChange(inputs.gold, date, months, true),
  policy: (() => {
    const a = valueOn(inputs.policy, date), b = valueOn(inputs.policy, monthsBack(date, months));
    return a != null && b != null ? a - b : null;
  })(),
  spx: logChange(inputs.spx, date, months, true),
});

// The archive's dividend record has gaps (almost none found 2006-2013 and in
// 2016): where the year before a date holds too few, yields are unknown.
const allCash = [...dividends.values()].flat().map((d) => d.date).sort();
const knownOn = new Map<string, boolean>();
const dividendsKnown = (date: string) => {
  let k = knownOn.get(date);
  if (k == null) {
    const from = new Date(Date.parse(date) - 365 * 86400000).toISOString().slice(0, 10);
    k = allCash.filter((d) => d > from && d <= date).length >= 150;
    knownOn.set(date, k);
  }
  return k;
};

const rows = buildPanel({
  bars,
  dividends,
  dividendsKnown,
  sectorOf: (s) => sectors.get(s) ?? null,
  members: (date) => members.get(Number(date.slice(0, 4))) ?? null,
  market,
  monthEnds,
  macro: (date) => macroState(date, inputs),
  factorMonthly: (date) => move(date, 1),
  factorPush: (date) => move(date, 3),
});
const NAMES = [...STOCK_NAMES, ...SECTOR_NAMES, ...MACRO_NAMES, ...SENS_NAMES];
console.log(`${secs()} panel: ${rows.length} rows, ${new Set(rows.map((r) => r.date)).size} months, ${NAMES.length} features, ${rows.filter((r) => r.sector).length} with a sector`);

const exportFile = argOf("export");
if (exportFile) {
  writeFileSync(exportFile, JSON.stringify({ names: NAMES, rows: rows.map((r) => [r.date, r.symbol, r.sector, r.x.map((v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null)), r.fwd1, r.fwd3, r.fwd6, r.pct3]) }));
  console.log(`wrote ${exportFile}`);
}

// --- candidates --------------------------------------------------------------
const col = (n: string) => NAMES.indexOf(n as any);
const subset = (names: readonly string[]) => names.map(col);
const pick = (x: number[], idx: number[]) => idx.map((j) => x[j]);
const noMacro = subset([...STOCK_NAMES, ...SECTOR_NAMES]);
const withSens = subset([...STOCK_NAMES, ...SECTOR_NAMES, ...SENS_NAMES]);
const all = subset(NAMES);
const sentinel = (x: number[]) => x.map((v) => (Number.isFinite(v) ? v : -1e9));

const candidates: Array<{ name: string; fit: (train: PanelRow[]) => (x: number[]) => number }> = [
  { name: "momentum (12-1 rank)", fit: () => (x) => x[col("rel12Rank")] },
  { name: "dividend yield rank", fit: () => (x) => x[col("dyRank")] },
  { name: "momentum + yield", fit: () => (x) => (x[col("rel12Rank")] + x[col("dyRank")]) / 2 },
  { name: "ridge, no macro", fit: (tr) => { const m = fitRidge(tr.map((r) => pick(r.x, noMacro)), tr.map((r) => r.pct3!), 50); return (x) => predictRidge(m, pick(x, noMacro)); } },
  { name: "ridge, with macro", fit: (tr) => { const m = fitRidge(tr.map((r) => pick(r.x, all)), tr.map((r) => r.pct3!), 50); return (x) => predictRidge(m, pick(x, all)); } },
  { name: "trees, no macro", fit: (tr) => { const m = trainGbm(tr.map((r) => sentinel(pick(r.x, noMacro))), tr.map((r) => r.pct3!), { rounds: 300, lr: 0.03, maxDepth: 3, minLeaf: 300, subsample: 0.7, colsample: 0.7, valFrac: 0.1, patience: 40, seed: 7 }); return (x) => predictGbm(m, sentinel(pick(x, noMacro))); } },
  { name: "trees, with macro", fit: (tr) => { const m = trainGbm(tr.map((r) => sentinel(pick(r.x, all))), tr.map((r) => r.pct3!), { rounds: 300, lr: 0.03, maxDepth: 3, minLeaf: 300, subsample: 0.7, colsample: 0.7, valFrac: 0.1, patience: 40, seed: 7 }); return (x) => predictGbm(m, sentinel(pick(x, all))); } },
  { name: "network, no macro", fit: (tr) => net(tr, noMacro) },
  { name: "network, with macro", fit: (tr) => net(tr, all) },
  { name: "network x5, no macro", fit: (tr) => net(tr, noMacro, 5) },
  { name: "network x5, sensitivities", fit: (tr) => net(tr, withSens, 5) },
  { name: "blend: network x5 + trees", fit: (tr) => blend(tr) },
];

// The network's and the trees' scores, as ranks within the month, averaged.
function blend(tr: PanelRow[]): (x: number[]) => number {
  const a = net(tr, noMacro, 5);
  const m = trainGbm(tr.map((r) => sentinel(pick(r.x, noMacro))), tr.map((r) => r.pct3!), { rounds: 300, lr: 0.03, maxDepth: 3, minLeaf: 300, subsample: 0.7, colsample: 0.7, valFrac: 0.1, patience: 40, seed: 7 });
  const b = (x: number[]) => predictGbm(m, sentinel(pick(x, noMacro)));
  // Each score centred on its training spread, so neither dominates.
  const sa = spreadOf(tr.map((r) => a(r.x))), sb = spreadOf(tr.map((r) => b(r.x)));
  return (x) => (a(x) - sa.mean) / sa.sd + (b(x) - sb.mean) / sb.sd;
}

function spreadOf(v: number[]) {
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return { mean, sd: Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) || 1 };
}

// Three seeds of the network, averaged.
function net(tr: PanelRow[], cols: number[], seeds = 3): (x: number[]) => number {
  const X = tr.map((r) => pick(r.x, cols)), y = tr.map((r) => r.pct3!);
  const nets = Array.from({ length: seeds }, (_, k) => k + 1).map((seed) => trainMlp(X, y, { hidden: [64, 32], epochs: 30, batch: 256, lr: 1e-3, dropout: 0.2, weightDecay: 1e-4, valFrac: 0.15, patience: 5, seed }));
  return (x) => {
    const v = pick(x, cols);
    return nets.reduce((s, m) => s + predictMlp(m, v), 0) / nets.length;
  };
}

const only = argOf("only");
const pct = (v: number, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%` : "  n/a");
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "  n/a");
const lastYear = Number(monthEnds[monthEnds.length - 1].slice(0, 4));
const results: Array<{ name: string; rec: WalkRecord }> = [];
for (const c of candidates) {
  if (only && !c.name.includes(only)) continue;
  const pred = walkForward(rows, c.fit, { fromYear: FROM, toYear: lastYear });
  const rec = summarise(scoreMonths(rows, pred));
  results.push({ name: c.name, rec });
  console.log(
    `${secs()} ${c.name.padEnd(22)} IC ${f3(rec.ic)} (t ${rec.icT.toFixed(1)})  spread ${pct(rec.spread)} (t ${rec.spreadT.toFixed(1)}, hit ${(rec.hit * 100).toFixed(0)}%)  sector IC ${f3(rec.sectorIc)} (t ${rec.sectorIcT.toFixed(1)})  | ` +
      rec.byEra.map((e) => `${e.from}-${String(e.to).slice(2)} ${f3(e.ic)}/${f3(e.sectorIc)}`).join("  ")
  );
}
const out = argOf("out");
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
