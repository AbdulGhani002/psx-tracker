// The daily analysis: the model's own reading of the market and of each name,
// with the zones it would write down itself, one picture per index and per
// holding, and a text short enough for a phone.
//
// The owner's own bands are shown as a note beside each verdict; they are
// not what the verdict is built on. The verdict comes from what the 24-year
// test showed to hold up: the market's strength (equal-weight index against
// its 200-day, breadth, eight chart tests, and what the KSE-100 did after past
// days in the same state), the name's rank among every name on the model's
// rank score with what names ranked there went on to do, its trend, the zones
// read off the model's path curve, and the dip odds (see analysis.ts).
//
// Two texts come out: `summary` for Telegram, `detail` for the weekly email.
// The whole report is also stored per user so the Analysis page can show it
// without rebuilding it. The model itself is trained on Abdul's machine and
// read here from the feed store; nothing in this file trains anything.

import "server-only";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import { getZoneBoard, getPortfolioSummary, getInflationLive, getSbpLive } from "@/lib/data";
import { assemblePlan } from "@/lib/plan";
import { uid } from "@/lib/auth/uid";
import { renderPriceChart, sma } from "@/lib/charts/price-chart";
import { readTrend, relativeReturn, realisedVolPct, volPercentile, DIP_PCT, LOW_TARGETS, HIGH_TARGETS, sigmaOverHorizon, type TrendRead } from "@/lib/quant/features";
import { buildPanel, predictEnsemble, describeAuc, rankScore, type TargetMetrics, type PanelRow, type CalibrationRow, type ZoneCoverage } from "@/lib/quant/panel";
import { marketContext, macroContext, mergeContext, breadthNow, MARKET_CONTEXT_NAMES, MACRO_CONTEXT_NAMES } from "@/lib/quant/context";
import { loadMacro, macroRead, type MacroKey } from "@/lib/timeseries/macro";
import { kse100Symbols, loadBars, TRAIN_INDICES } from "@/lib/quant/universe";
import { loadQuantModel, loadQuantSnapshot, saveQuantSnapshot, mongoBarsCache, type StoredQuantModel } from "@/lib/quant/store";
import { projectLevels, levelsLine, pathLevels, WALK_CURVE, type Projection, type PathLevels } from "@/lib/quant/projection";
import { equalWeightIndex } from "@/lib/quant/archive";
import { indexStates, cellOutlook, strengthTests, type CellOutlook, type StrengthTest } from "@/lib/quant/outlook";
import { readMarket, readName, triggerFor, edgeLine, VERDICT_RANK, type MarketRead, type ModelVerdict, type ModelZone, type NameStanding, type DecileEdge } from "@/lib/quant/analysis";
import type { StrategyResult } from "@/lib/quant/strategy";

export const INDICES: Array<{ symbol: string; title: string }> = [
  { symbol: "KSE100", title: "KSE-100" },
  { symbol: "KMI30", title: "KMI-30" },
  { symbol: "KSE30", title: "KSE-30" },
];

export type Verdict = ModelVerdict | "INDEX";

export type Forecast = {
  rel: number; // the rank score
  beat: number;
  dip: number;
  up: number;
  pLow: number[]; // the path curve's knots, lows
  pHigh: number[];
  learned: boolean; // false when the model carries no path heads and the plain walk stood in
  horizon: number;
};

export type ModelRecord = {
  up: TargetMetrics;
  beat: TargetMetrics;
  dip: TargetMetrics;
  rel: TargetMetrics | null;
  from: string;
  to: string;
  names: number;
  icRel: { mean: number; tStat: number } | null;
  calibration: CalibrationRow[] | null;
  zones: ZoneCoverage | null;
};

export type ReportItem = {
  symbol: string;
  title: string;
  png: Buffer;
  caption: string;
  trend: TrendRead | null;
  verdict: Verdict;
  verdictLine: string;
  standing: NameStanding | null;
  pctile: number | null;
  rank: { pos: number; of: number } | null;
  edge: DecileEdge;
  edgeLine: string;
  zone: ModelZone | null;
  levels: PathLevels | null;
  yourZone: string;
  forecast: Forecast | null;
  projection: Projection | null;
  outlook: CellOutlook | null; // indices only
  strength: StrengthTest[] | null; // indices only
  last: number;
  dayChangePct: number;
  relative: { rel20Pct: number; rank: number; of: number } | null;
  vol: { pct: number; percentile: number | null } | null;
};

export type QuantReport = {
  date: string;
  indices: ReportItem[];
  holdings: ReportItem[];
  market: MarketRead | null;
  summary: string; // short, for the phone
  detail: string; // long, for the weekly email
  modelNote: string;
  record: ModelRecord | null;
  strategy: StrategyResult | null;
  model: { trainedOn: string; trainedFrom: string; horizon: number; names: number; learners: string; heads: number } | null;
};

// What the Analysis page reads back: the report without the buffers.
export type StoredReportItem = Omit<ReportItem, "png"> & { png: string };
export type StoredReport = Omit<QuantReport, "indices" | "holdings"> & { builtAt: string; indices: StoredReportItem[]; holdings: StoredReportItem[] };

type LongValidation = { years: string; names: number; rows: number; summary: { targets: TargetMetrics[]; ic: { mean: number }; icRel: { mean: number; tStat: number } }; strategy?: StrategyResult };

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const odds = (p: number) => `${Math.round(p * 100)}%`;
const money = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

// The dip odds get a say only when their record is at least "real but modest".
const RECORD_FLOOR = 0.58;

const recordWords = (m: TargetMetrics) => `AUC ${m.auc.toFixed(2)}, ${describeAuc(m.auc)}`;

function yourBands(zone: { buyZoneLow: number | null; buyZoneHigh: number | null; sellZoneLow: number | null; sellZoneHigh: number | null } | undefined): string {
  if (!zone) return "";
  const b = zone.buyZoneHigh != null ? `buy ${zone.buyZoneLow != null ? money(zone.buyZoneLow) + " to " : "up to "}${money(zone.buyZoneHigh)}` : "";
  const s = zone.sellZoneLow != null ? `sell ${money(zone.sellZoneLow)}${zone.sellZoneHigh != null ? " to " + money(zone.sellZoneHigh) : "+"}` : "";
  return [b, s].filter(Boolean).join(", ");
}

export function zoneLine(z: ModelZone): string {
  return `Model zone: buy ${money(z.buyHigh)} down to ${money(z.buyLow)} · sell ${money(z.sellLow)} to ${money(z.sellHigh)} · case fails below ${money(z.fails)}${z.trigger ? ` · turns on a close above ${money(z.trigger)}` : ""}.`;
}

// The index outlook in one line: the state, the count, the odds against the
// base rate, the levels.
export function outlookLine(o: CellOutlook, dipLevel: number): string {
  return `Next ${o.horizon} sessions, after past days like this (${o.label}; ${Math.round(o.periods)} periods since 1998): higher ${odds(o.pUp)} of the time, ${odds(o.base.pUp)} in all periods; median ${money(o.levels[2])} (${pct(o.medianPct)}); middle range ${money(o.levels[1])} to ${money(o.levels[3])}, wide ${money(o.levels[0])} to ${money(o.levels[4])}; a 5% dip to ${money(dipLevel)} first ${odds(o.pDip)} of the time.`;
}

function strengthLine(tests: StrengthTest[]): string {
  const pass = tests.filter((t) => t.pass).length;
  return `Strength ${pass} of ${tests.length}: ${tests.map((t) => `${t.pass ? "✓" : "✗"} ${t.name} (${t.detail})`).join("; ")}.`;
}

// Short captions: what it is, where the model puts it, what to do.
function captionFor(item: Omit<ReportItem, "png" | "caption">, rec: ModelRecord | null): string {
  const head = `<b>${item.title}</b>  ${money(item.last)}  (${pct(item.dayChangePct, 2)})${item.trend ? ` · ${item.trend.label.toLowerCase()}` : ""}${item.rank ? ` · rank ${item.rank.pos} of ${item.rank.of} by the model` : ""}`;
  const lines = [head];
  if (item.verdict === "INDEX") {
    if (item.outlook && item.projection) lines.push(outlookLine(item.outlook, item.projection.dipLevel) + (item.symbol === "KSE100" ? "" : " (the KSE-100's table, read with this index's state.)"));
    if (item.strength) lines.push(strengthLine(item.strength));
    if (item.projection) lines.push(levelsLine(item.projection));
  } else {
    if (item.forecast && item.levels) {
      const f = item.forecast;
      lines.push(`${item.edgeLine ? item.edgeLine.charAt(0).toUpperCase() + item.edgeLine.slice(1) + ". " : ""}Odds of a ${DIP_PCT}% dip first ${odds(f.dip)}; half of paths like this one dip ${item.levels.medianLowPct.toFixed(1)}% and rise ${item.levels.medianHighPct.toFixed(1)}% within ${f.horizon} sessions${f.learned ? "" : " (plain walk; this model has no path heads)"}.`);
    }
    if (item.zone) lines.push(zoneLine(item.zone));
    lines.push(`<b>${item.verdict}</b>: ${item.verdictLine}`);
    if (item.yourZone) lines.push(`<i>Your band: ${item.yourZone}.</i>`);
  }
  return lines.filter(Boolean).join("\n").slice(0, 1024);
}

// Rebuild today's context in exactly the layout the stored model was trained
// on. If that cannot be done, the report goes out without forecasts rather
// than with forecasts on the wrong inputs.
async function contextFor(model: StoredQuantModel, stockBars: Map<string, EodBar[]>, index: EodBar[]): Promise<{ context: Map<string, number[]> | null; reason: string }> {
  const wantMarket = model.contextNames.some((n) => (MARKET_CONTEXT_NAMES as readonly string[]).includes(n));
  const wantMacro = model.contextNames.some((n) => (MACRO_CONTEXT_NAMES as readonly string[]).includes(n));
  if (!wantMarket && !wantMacro) return { context: new Map(), reason: "" };
  const dates = index.map((b) => b.date);
  const market = wantMarket ? marketContext(stockBars, index) : null;
  let macro: Map<string, number[]> | null = null;
  if (wantMacro) {
    const m = await loadMacro(mongoBarsCache(24)).catch(() => null);
    if (!m) return { context: null, reason: "the macro feed (rupee, oil, global risk) could not be read today" };
    macro = macroContext(m, dates);
  }
  const merged = mergeContext(market, macro, dates);
  const names = merged?.names ?? [];
  if (names.length !== model.contextNames.length || names.some((n, i) => n !== model.contextNames[i])) {
    return { context: null, reason: "the context layout has changed since the model was trained; it needs retraining" };
  }
  return { context: merged!.context, reason: "" };
}

export async function buildQuantReport(): Promise<QuantReport> {
  const today = new Date().toISOString().slice(0, 10);
  const [board, portfolio, model, plan, inflation, sbp, long, userId, uni] = await Promise.all([
    getZoneBoard().catch(() => null),
    getPortfolioSummary().catch(() => null),
    loadQuantModel().catch(() => null),
    assemblePlan().catch(() => null),
    getInflationLive().catch(() => null),
    getSbpLive().catch(() => null),
    loadQuantSnapshot<LongValidation>("quant:validation:long").catch(() => null),
    uid().catch(() => ""),
    kse100Symbols().catch(() => ({ symbols: [] as string[], source: "none" })),
  ]);
  const zoneBySymbol = new Map((board?.rows ?? []).map((r) => [r.symbol, r]));
  const posBySymbol = new Map((portfolio?.positions ?? []).filter((p) => p.shares > 0).map((p) => [p.symbol, p]));
  const held = [...posBySymbol.keys()];
  const horizon = model?.horizon ?? 20;

  // The production universe is today's KSE-100 plus whatever is held. The
  // model is scale-free and was trained on a wider, older universe; any name
  // with a year of history can be scored.
  const symbols = [...new Set([...TRAIN_INDICES, ...uni.symbols, ...held])];
  const bars = await loadBars(symbols, mongoBarsCache(6));
  const kse = bars.get("KSE100") ?? [];
  const stockBars = new Map([...bars].filter(([s]) => !TRAIN_INDICES.includes(s)));
  const ew = equalWeightIndex(stockBars);
  // Features are built on the index the model was trained against.
  const featureIndex = model?.indexKind === "equal-weight" ? ew : kse;

  const lastRows = new Map<string, PanelRow>();
  // The last five sessions' rows too: a name's standing (its fifth) is taken
  // over them, so one session at a boundary does not flip a verdict.
  const recentRows = new Map<string, PanelRow[]>();
  let noModelReason = "";
  if (!model) noModelReason = "no trained model in the store yet";
  else if (featureIndex.length < 300) noModelReason = "not enough index history to build features";
  else {
    const c = await contextFor(model, stockBars, featureIndex);
    noModelReason = c.reason;
    if (c.context) {
      const panel = buildPanel(stockBars, featureIndex, model.horizon, { context: c.context, ranks: (model.rankNames ?? []).length > 0, minRows: 1 });
      const firstRecent = panel.dates[Math.max(0, panel.dates.length - 5)];
      for (const r of panel.rows) {
        lastRows.set(r.symbol, r);
        if (r.date >= firstRecent) {
          const g = recentRows.get(r.date);
          if (g) g.push(r);
          else recentRows.set(r.date, [r]);
        }
      }
    }
  }

  const v = model?.validation;
  const rec: ModelRecord | null =
    v && v.targets.length >= 3
      ? {
          up: v.targets[0],
          beat: v.targets[1],
          dip: v.targets[2],
          rel: v.targets[3] ?? null,
          from: v.from,
          to: v.to,
          names: v.symbols,
          icRel: v.icRel ? { mean: v.icRel.mean, tStat: v.icRel.tStat } : null,
          calibration: v.calibration ?? null,
          zones: v.zones ?? null,
        }
      : null;
  const dipUsable = !!rec && rec.dip.auc >= RECORD_FLOOR;
  const strategy = model?.strategy ?? long?.strategy ?? null;

  // Forecasts for the names, and their rank on the rank score.
  const forecasts = new Map<string, Forecast>();
  if (model && !noModelReason) {
    for (const [symbol, row] of lastRows) {
      if (row.x.length !== model.featureNames.length) continue;
      try {
        const p = predictEnsemble(model.learners, row.x);
        const learned = p.length > HIGH_TARGETS[2];
        forecasts.set(symbol, {
          rel: rankScore(p),
          beat: p[1],
          dip: p[2],
          up: p[0],
          pLow: learned ? LOW_TARGETS.map((i) => p[i]) : [...WALK_CURVE],
          pHigh: learned ? HIGH_TARGETS.map((i) => p[i]) : [...WALK_CURVE],
          learned,
          horizon: model.horizon,
        });
      } catch {
        /* a name that cannot be scored is left without odds */
      }
    }
  }
  const relValues = [...forecasts.values()].map((f) => f.rel);
  const pctileOf = (symbol: string): number | null => {
    const f = forecasts.get(symbol);
    if (!f || relValues.length < 8) return null;
    return relValues.filter((b) => b < f.rel).length / (relValues.length - 1);
  };
  const rankOf = (symbol: string): { pos: number; of: number } | null => {
    const f = forecasts.get(symbol);
    if (!f || relValues.length < 8) return null;
    return { pos: relValues.filter((b) => b > f.rel).length + 1, of: relValues.length };
  };
  // Standing over the last five sessions: each day's percentile, averaged.
  const recentPctile = new Map<string, number[]>();
  const recentPos = new Map<string, number[]>();
  if (model && !noModelReason) {
    for (const [, rows] of recentRows) {
      const scored: Array<{ symbol: string; rel: number }> = [];
      for (const r of rows) {
        if (r.x.length !== model.featureNames.length) continue;
        try {
          scored.push({ symbol: r.symbol, rel: rankScore(predictEnsemble(model.learners, r.x)) });
        } catch {
          /* skipped */
        }
      }
      if (scored.length < 8) continue;
      for (const s of scored) {
        const below = scored.filter((o) => o.rel < s.rel).length;
        const above = scored.filter((o) => o.rel > s.rel).length;
        (recentPctile.get(s.symbol) ?? recentPctile.set(s.symbol, []).get(s.symbol)!).push(below / (scored.length - 1));
        (recentPos.get(s.symbol) ?? recentPos.set(s.symbol, []).get(s.symbol)!).push(above + 1);
      }
    }
  }
  const pctile5Of = (symbol: string): number | null => {
    const v = recentPctile.get(symbol);
    return v && v.length ? v.reduce((a, b) => a + b, 0) / v.length : pctileOf(symbol);
  };
  const rank5Of = (symbol: string): { pos: number; of: number } | null => {
    const v = recentPos.get(symbol);
    const today = rankOf(symbol);
    return v && v.length && today ? { pos: Math.round(v.reduce((a, b) => a + b, 0) / v.length), of: today.of } : null;
  };
  const edgeOf = (pctile: number | null): DecileEdge => {
    if (pctile == null || !rec?.calibration || rec.calibration.length !== 10) return null;
    const c = rec.calibration[Math.min(9, Math.floor(pctile * 10))];
    return { decile: c.decile, meanRelPct: c.meanRelPct, beatRate: c.beatRate };
  };

  // Market strength, from the names themselves; the KSE-100's chart tests and
  // what it did after past days in the same state.
  const br = breadthNow(stockBars);
  const breadthMap = new Map<string, number>();
  for (const b of kse) breadthMap.set(b.date, br.above200Pct / 100);
  const outlookFor = (b: EodBar[]): { outlook: CellOutlook | null; tests: StrengthTest[] } => {
    if (b.length < 260) return { outlook: null, tests: [] };
    const states = indexStates(b.slice(-320).map((x) => ({ date: x.date, close: x.close })), horizon, breadthMap);
    const last = states[states.length - 1];
    if (!last) return { outlook: null, tests: [] };
    const tests = strengthTests(last, br.names >= 20 ? br.above50Pct / 100 : null);
    const outlook = model?.indexOutlook ? cellOutlook(model.indexOutlook.model, last, 1) : null;
    return { outlook, tests };
  };
  const kseRead = outlookFor(kse);
  let market: MarketRead | null = null;
  if (ew.length >= 200 && br.names >= 20) {
    const level = ew[ew.length - 1].close;
    const ma200 = ew.slice(-200).reduce((s, b) => s + b.close, 0) / 200;
    market = readMarket({ indexAbove200: level > ma200, ewLevel: level, ewMa200: ma200, breadth200Pct: br.above200Pct, breadth50Pct: br.above50Pct, tests: kseRead.tests, outlook: kseRead.outlook, outlookRecord: model?.indexOutlook?.record ?? null });
  }

  const relTable: Array<{ symbol: string; rel: number }> = [];
  for (const [s, b] of stockBars) {
    const r = relativeReturn(b, kse, 20);
    if (r != null) relTable.push({ symbol: s, rel: r });
  }
  relTable.sort((a, b) => b.rel - a.rel);

  const make = (symbol: string, title: string, heldName: boolean): ReportItem | null => {
    const b = bars.get(symbol);
    if (!b || b.length < 260) return null;
    const closes = b.map((x) => x.close);
    const m50 = sma(closes, 50);
    const m200 = sma(closes, 200);
    const from = Math.max(0, b.length - 260);
    const window = b.slice(from);
    const last = window[window.length - 1];
    const prev = window[window.length - 2];
    const dayChangePct = prev ? (last.close / prev.close - 1) * 100 : 0;
    const trend = readTrend(b);
    const zone = zoneBySymbol.get(symbol);
    const pos = posBySymbol.get(symbol);
    const forecast = heldName ? forecasts.get(symbol) ?? null : null;
    const pctile = heldName ? pctile5Of(symbol) : null;
    const rank = heldName ? rankOf(symbol) : null;
    const rank5 = heldName ? rank5Of(symbol) : null;
    const edge = edgeOf(pctile);

    let verdict: Verdict = "INDEX";
    let verdictLine = "";
    let standing: NameStanding | null = null;
    let modelZone: ModelZone | null = null;
    let levels: PathLevels | null = null;
    let projection: Projection | null = null;
    let outlook: CellOutlook | null = null;
    let strength: StrengthTest[] | null = null;

    if (!heldName) {
      const read = symbol === "KSE100" ? kseRead : outlookFor(b);
      outlook = read.outlook;
      strength = read.tests.length ? read.tests : null;
      // The fan is the wide range of the state table (a tenth of past paths
      // ended outside it), or the plain base rate when there is no table.
      const centre = outlook ? Math.log(outlook.levels[2] / last.close) : 0;
      projection = projectLevels(b, horizon, outlook?.pUp ?? 0.6, outlook?.pDip ?? 0.3, DIP_PCT, centre);
      if (projection && outlook) {
        projection.low = outlook.levels[0];
        projection.high = outlook.levels[4];
      }
    } else if (forecast) {
      // The name's centre: the market's median move in its state plus what
      // names ranked here went on to do against the market.
      const sigmaH = sigmaOverHorizon(realisedVolPct(b, 60)! / 100 / Math.sqrt(252), forecast.horizon);
      levels = pathLevels(last.close, sigmaH, forecast.pLow, forecast.pHigh);
      const marketMove = kseRead.outlook ? Math.log(kseRead.outlook.levels[2] / kse[kse.length - 1].close) : 0;
      const centre = marketMove + (edge ? edge.meanRelPct / 100 : 0);
      projection = projectLevels(b, forecast.horizon, forecast.up, forecast.dip, DIP_PCT, centre);
      if (projection) projection.dipLevel = levels.fails;
      if (projection && market) {
        const read = readName({
          held: true,
          market: market.state,
          pctile,
          rank,
          rank5,
          edge,
          trend,
          price: last.close,
          levels,
          trigger: triggerFor(last.close, projection.ma50, projection.ma200, projection.high20),
          ma200: projection.ma200,
          pDip: forecast.dip,
          dipUsable,
          horizon: forecast.horizon,
        });
        verdict = read.verdict;
        verdictLine = read.line;
        standing = read.standing;
        modelZone = read.zone;
      } else {
        verdict = "HOLD";
        verdictLine = "No market reading today; the position stands.";
      }
    } else {
      verdict = "HOLD";
      verdictLine = noModelReason ? `No model reading today (${noModelReason}); the position stands.` : "No model reading for this name today; the position stands.";
    }

    const relIdx = relTable.findIndex((r) => r.symbol === symbol);
    const relative = heldName && relIdx >= 0 ? { rel20Pct: relTable[relIdx].rel * 100, rank: relIdx + 1, of: relTable.length } : null;
    const volPct = heldName ? realisedVolPct(b, 20) : null;
    const vol = volPct != null ? { pct: volPct, percentile: volPercentile(b, 20, 250) } : null;

    const png = renderPriceChart({
      title,
      subtitle: trend ? trend.short : undefined,
      bars: window,
      ma50: m50.slice(from),
      ma200: m200.slice(from),
      // The model's own zones on the chart; the owner's are in the note.
      buyZone: modelZone ? { low: modelZone.buyLow, high: modelZone.buyHigh } : undefined,
      sellZone: modelZone ? { low: modelZone.sellLow, high: modelZone.sellHigh } : undefined,
      avgCost: pos?.avgCost ?? null,
      projection: projection ? { horizon: projection.horizon, median: projection.median, low: projection.low, high: projection.high, dipLevel: projection.dipLevel, dipLabel: heldName ? "FAIL" : "DIP" } : null,
      footer: `LAST ${last.close.toFixed(2)}  ${pct(dayChangePct, 2)} ON THE DAY${heldName ? `   ${verdict}` : ""}${rank ? `   RANK ${rank.pos}/${rank.of}` : ""}${outlook ? `   ${odds(outlook.pUp)} HIGHER IN ${outlook.horizon}D` : ""}`,
    });

    const base = {
      symbol,
      title,
      trend,
      verdict,
      verdictLine,
      standing,
      pctile,
      rank,
      edge,
      edgeLine: edge ? edgeLine(edge, horizon) : "",
      zone: modelZone,
      levels,
      yourZone: yourBands(zone),
      forecast,
      projection,
      outlook,
      strength,
      last: last.close,
      dayChangePct,
      relative,
      vol,
    };
    return { ...base, png, caption: captionFor(base, rec) };
  };

  const indices: ReportItem[] = [];
  for (const ix of INDICES) {
    const item = make(ix.symbol, ix.title, false);
    if (item) indices.push(item);
  }
  const holdings: ReportItem[] = [];
  for (const [symbol, pos] of posBySymbol) {
    const item = make(symbol, `${symbol} ${pos.name ?? ""}`.trim(), true);
    if (item) holdings.push(item);
  }
  const verdictOrder = (vv: Verdict) => (vv === "INDEX" ? 99 : VERDICT_RANK[vv]);
  holdings.sort((a, b) => verdictOrder(a.verdict) - verdictOrder(b.verdict) || (b.pctile ?? 0) - (a.pctile ?? 0) || a.symbol.localeCompare(b.symbol));

  // --- the market and the model, in words ------------------------------------
  const kseItem = indices.find((i) => i.symbol === "KSE100");
  const idxShort = indices.map((i, k) => (k === 0 ? `${i.title} ${money(i.last)} (${pct(i.dayChangePct)})${i.trend ? " " + i.trend.label.toLowerCase() : ""}` : `${i.title} ${pct(i.dayChangePct)}`)).join(" · ");
  const idxLong = indices.map((i) => `${i.title} ${money(i.last)} (${pct(i.dayChangePct, 2)})${i.trend ? ", " + i.trend.line : ""}`).join("\n");
  const marketShort = market
    ? `Market ${market.state}${market.tests.length ? ` (${market.score} of ${market.tests.length} strength tests)` : ""}: equal-weight index ${market.indexAbove200 ? "above" : "below"} its 200d, ${market.breadth200Pct.toFixed(0)}% of names above theirs, ${market.breadth50Pct.toFixed(0)}% above their 50d.`
    : "";
  const o = kseItem?.outlook;
  const outlookShort = o && kseItem?.projection
    ? `KSE-100 next ${o.horizon} sessions, from ${Math.round(o.periods)} past states like this (${o.label}): higher ${odds(o.pUp)} of the time (all states ${odds(o.base.pUp)}); median ${money(o.levels[2])}, range ${money(o.levels[1])} to ${money(o.levels[3])}, wide ${money(o.levels[0])} to ${money(o.levels[4])}; 5% dip to ${money(kseItem.projection.dipLevel)} first ${odds(o.pDip)}.`
    : "";
  const regime = plan?.regime;
  const regimeLong = regime ? `Your playbook's regime: ${regime.label} (score ${regime.rawScore >= 0 ? "+" : ""}${regime.rawScore} of ${regime.maxScore}), cash floor ${regime.cashFloorPct}%.` : "";

  const macroBars = await loadMacro(mongoBarsCache(24)).catch(() => null);
  const m = (k: MacroKey, days: number) => (macroBars ? macroRead(macroBars.get(k) ?? [], days) : null);
  const pkr = m("usdpkr", 28), oil = m("oil", 28);
  const cpi = inflation?.yoyPct ?? null;
  const policy = sbp?.rates?.policyRatePct ?? null;
  const tb = sbp?.rates?.mtbCutoffs?.find((t: any) => t.tenor === "12M")?.yieldPct;
  const macroShort = [pkr ? `PKR ${pkr.last.toFixed(1)}` : "", oil ? `WTI $${oil.last.toFixed(0)}` : "", cpi != null ? `CPI ${cpi.toFixed(1)}%` : "", policy != null ? `policy ${policy}%` : "", tb != null ? `12M T-bill ${Number(tb).toFixed(1)}%` : ""].filter(Boolean).join(" · ");
  const macroLong = [
    pkr ? `USD/PKR ${pkr.last.toFixed(1)} (${pct(pkr.changePct)} in 4 weeks)` : "",
    oil ? `WTI $${oil.last.toFixed(0)} (${pct(oil.changePct)} in 4 weeks)` : "",
    cpi != null ? `CPI ${cpi.toFixed(1)}% YoY${inflation?.latest?.period ? ` (${inflation.latest.period})` : ""}` : "",
    policy != null ? `policy rate ${policy}%${cpi != null ? `, real ${pct(policy - cpi)}` : ""}` : "",
    tb != null ? `12M T-bill ${Number(tb).toFixed(2)}%` : "",
  ].filter(Boolean);

  let modelNote: string;
  if (!model) {
    modelNote = "Model: none trained yet.";
  } else if (noModelReason) {
    modelNote = `Model: no forecasts today, ${noModelReason}.`;
  } else if (!rec) {
    modelNote = "Model: trained, but without a walk-forward record; treat its odds as decoration.";
  } else {
    const learners = model.learners.map((l) => l.kind).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
    const what = Object.entries(learners).map(([k, n]) => `${n} ${k === "gbm" ? "boosted-tree" : "network"} model${n > 1 ? "s" : ""}`).join(" and ");
    const heads = model.targetNames.length;
    const span = model.trainedFrom === "archive" ? `the exchange's archive, ${model.universe.length} names that were each among the most traded of their year, to ${model.trainedTo}` : `${model.universe.length} names to ${model.trainedTo}`;
    const parts = [
      `<b>Model</b>: ${what} with ${heads} heads each, trained on ${span}, ${model.horizon} sessions ahead, with market breadth as context.`,
      `Walk-forward record ${rec.from} to ${rec.to}${model.trainedFrom === "archive" ? " (out of sample throughout, no survivorship bias)" : ""}: ranking of names IC ${rec.icRel ? `${rec.icRel.mean >= 0 ? "+" : ""}${rec.icRel.mean.toFixed(3)} (t ${rec.icRel.tStat.toFixed(1)})` : "n/a"}; ${DIP_PCT}% dip ${recordWords(rec.dip)}; direction ${recordWords(rec.up)}.`,
    ];
    if (rec.calibration && rec.calibration.length === 10) {
      const top = rec.calibration[9], bottom = rec.calibration[0];
      parts.push(`What the ranking was worth: the top tenth of names by rank score went on to beat the market by ${pct(top.meanRelPct)} per ${model.horizon} sessions (${odds(top.beatRate)} of them ahead), the bottom tenth trailed it by ${pct(bottom.meanRelPct)} (${odds(bottom.beatRate)} ahead).`);
    }
    if (rec.zones) {
      const z = rec.zones;
      parts.push(`The zones, out of sample on ${z.n.toLocaleString()} paths: the top of the buy zone was reached by ${odds(z.buyHigh)} of paths (built to be a half), its bottom by ${odds(z.buyLow)} (a quarter), the fail level by ${odds(z.fails)} (a tenth); the sell zone's bottom by ${odds(z.sellLow)} (a half), its top by ${odds(z.sellHigh)} (a quarter).`);
    }
    if (strategy) {
      const uni = strategy.legs[0], gated = strategy.legs[4], topLeg = strategy.legs[1];
      parts.push(`The rule as a rule, ${strategy.from} to ${strategy.to}: universe held outright ${pct(uni.cagrPct)} a year with a worst fall of ${pct(uni.maxDrawdownPct, 0)}; the model's top fifth ${pct(topLeg.cagrPct)} a year (${pct(topLeg.maxDrawdownPct, 0)}); the top fifth only while the market is strong ${pct(gated.cagrPct)} a year with a worst fall of ${pct(gated.maxDrawdownPct, 0)}, in the market ${gated.inMarketPct.toFixed(0)}% of the time, after 0.3% costs per rebalance.`);
    }
    if (model.indexOutlook) {
      const r = model.indexOutlook.record;
      parts.push(`The KSE-100 state table (${model.indexOutlook.seriesFrom.slice(0, 4)} to date), walk-forward ${r.from.slice(0, 4)} to ${r.to.slice(0, 4)} on ${r.n} periods: direction Brier ${r.brier.toFixed(3)} against ${r.brierBase.toFixed(3)} for the plain base rate (${pct(r.brierSkillPct)} skill), dip odds ${pct(r.dipSkillPct)} skill, the wide range held ${odds(r.cover80)} of outcomes (built for 80%).`);
    }
    if (market) parts.push(market.line);
    parts.push(`<i>What to trust: the ranking of names and the zones' widths (both held out of sample for twenty years); the state table moves the index odds a little; the direction head is a coin toss and is not used.</i>`);
    modelNote = parts.join("\n");
  }

  const byVerdict = (vv: ModelVerdict) => holdings.filter((h) => h.verdict === vv).map((h) => h.symbol);
  const says: string[] = [];
  for (const vv of ["BUY", "STAGE", "SELL", "TRIM", "WATCH", "WAIT"] as ModelVerdict[]) {
    const names = byVerdict(vv);
    if (names.length) says.push(`${vv} ${names.join(", ")}`);
  }
  const saysShort = says.length ? `Model says: ${says.join(" · ")}.` : "Model says: nothing to do today; every name held is a HOLD.";
  const ranked = holdings.filter((h) => h.rank).sort((a, b) => a.rank!.pos - b.rank!.pos);
  const rankShort = ranked.length >= 2 ? `Rank of ${ranked[0].rank!.of}: ${ranked.map((h) => `${h.symbol} ${h.rank!.pos}`).join(" · ")}.` : "";

  const summary = [`<b>Analysis ${today}</b>`, idxShort, marketShort, outlookShort, saysShort, rankShort, macroShort]
    .filter((l) => l !== "")
    .join("\n")
    .slice(0, 4096);

  const holdingLines = holdings.map((h) => {
    const bits = [`${h.symbol} ${money(h.last)} (${pct(h.dayChangePct)})${h.trend ? `, ${h.trend.label.toLowerCase()}` : ""}${h.rank ? `, rank ${h.rank.pos} of ${h.rank.of}` : ""}`];
    if (h.edgeLine) bits.push(h.edgeLine);
    if (h.forecast) bits.push(`odds of a ${DIP_PCT}% dip first ${odds(h.forecast.dip)}`);
    if (h.zone) bits.push(zoneLine(h.zone).replace(/\.$/, ""));
    bits.push(`${h.verdict}: ${h.verdictLine}`);
    if (h.yourZone) bits.push(`your band: ${h.yourZone}`);
    return bits.join(". ");
  });
  const detail = [
    `Analysis for ${today}`,
    idxLong,
    market ? market.line : "",
    market?.tests.length ? strengthLine(market.tests) : "",
    market?.outlookLine ?? "",
    `Breadth across ${br.names} names: ${br.above50Pct.toFixed(0)}% above their 50-day, ${br.above200Pct.toFixed(0)}% above their 200-day, ${br.adv20Pct.toFixed(0)}% up over 20 sessions.`,
    regimeLong,
    macroLong.length ? `Pakistan: ${macroLong.join("; ")}.` : "",
    "",
    modelNote.replace(/<\/?[bi]>/g, ""),
    "",
    saysShort,
    rankShort,
    "",
    ...holdingLines,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const report: QuantReport = {
    date: today,
    indices,
    holdings,
    market,
    summary,
    detail,
    modelNote,
    record: rec,
    strategy,
    model: model
      ? { trainedOn: model.trainedOn, trainedFrom: model.trainedFrom ?? "eod", horizon: model.horizon, names: model.universe.length, learners: model.learners.map((l) => l.kind).join("+"), heads: model.targetNames.length }
      : null,
  };

  // Kept per user for the Analysis page and for the app's zone views.
  if (userId) {
    const strip = (it: ReportItem): StoredReportItem => ({ ...it, png: it.png.toString("base64") });
    const stored: StoredReport = { ...report, builtAt: new Date().toISOString(), indices: indices.map(strip), holdings: holdings.map(strip) };
    await saveQuantSnapshot(`quant:report:${userId}`, stored, `${holdings.length} names, ${today}`).catch(() => {});
    if (holdings.some((h) => h.zone)) {
      await saveQuantSnapshot(
        `quant:zones:${userId}`,
        { at: today, horizon, bands: holdings.filter((h) => h.zone).map((h) => ({ symbol: h.symbol, verdict: h.verdict, ...h.zone!, centre: h.projection?.median ?? null })) },
        `${holdings.filter((h) => h.zone).length} names`
      ).catch(() => {});
    }
  }
  return report;
}
