// The daily chart report: one picture per index and per holding, a trend read
// under each, the model's odds beside their measured record, and a verdict on
// whether today is a day to add to a position you already own.
//
// The verdict is the useful part and it is deliberately simple. Your buy zone
// says whether the PRICE is right; the trend says whether the price is still
// falling. Both have to agree before it says buy. The model earns a voice in
// the verdict only where its walk-forward record says it has one, which today
// is the dip odds: when they are high, a buy is staged rather than taken.
//
// The model itself is trained once a week by its own process (scripts/
// quant-train.ts) and read here from the feed store. Nothing in this file
// trains anything; a report must never block the server for minutes.

import "server-only";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import { getZoneBoard, getPortfolioSummary, getInflationLive, getSbpLive } from "@/lib/data";
import { assemblePlan } from "@/lib/plan";
import { renderPriceChart, sma } from "@/lib/charts/price-chart";
import { buildFeatures, readTrend, relativeReturn, realisedVolPct, volPercentile, DIP_PCT, type TrendRead } from "@/lib/quant/features";
import { predictEnsemble, describeAuc, type TargetMetrics, type SymbolMetrics } from "@/lib/quant/panel";
import { marketContext, macroContext, mergeContext, breadthNow, MARKET_CONTEXT_NAMES, MACRO_CONTEXT_NAMES } from "@/lib/quant/context";
import { loadMacro, macroRead, type MacroKey } from "@/lib/timeseries/macro";
import { loadBars, TRAIN_INDICES } from "@/lib/quant/universe";
import { loadQuantModel, loadQuantSnapshot, mongoBarsCache, type StoredQuantModel } from "@/lib/quant/store";

export const INDICES: Array<{ symbol: string; title: string }> = [
  { symbol: "KSE100", title: "KSE-100" },
  { symbol: "KMI30", title: "KMI-30" },
  { symbol: "KSE30", title: "KSE-30" },
];

export type Verdict = "BUY" | "WAIT" | "HOLD" | "TRIM" | "SET ZONE" | "INDEX";

export type Forecast = { up: number; beat: number; dip: number; horizon: number };

export type ModelRecord = {
  up: TargetMetrics;
  beat: TargetMetrics;
  dip: TargetMetrics;
  own: SymbolMetrics | null;
  from: string;
  to: string;
  names: number;
};

export type ReportItem = {
  symbol: string;
  title: string;
  png: Buffer;
  caption: string;
  trend: TrendRead | null;
  verdict: Verdict;
  verdictLine: string;
  forecast: Forecast | null;
  last: number;
  dayChangePct: number;
  relative: { rel20Pct: number; rank: number; of: number } | null;
  vol: { pct: number; percentile: number | null } | null;
};

export type QuantReport = {
  date: string;
  indices: ReportItem[];
  holdings: ReportItem[];
  summary: string;
  modelNote: string;
  model: { trainedOn: string; horizon: number; names: number; learners: string } | null;
};

type LongValidation = { years: string; names: number; rows: number; summary: { targets: TargetMetrics[]; ic: { mean: number }; icRel: { mean: number; tStat: number } } };

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const odds = (p: number) => `${Math.round(p * 100)}%`;

// The model gets a say in the verdict only through a target whose record is
// at least "real but modest".
const RECORD_FLOOR = 0.58;

function verdictFor(
  zone: { status: string; buyZoneLow: number | null; buyZoneHigh: number | null; price: number | null } | undefined,
  trend: TrendRead | null,
  held: boolean,
  dip: { p: number; auc: number; horizon: number } | null
): { verdict: Verdict; line: string } {
  if (!held) return { verdict: "INDEX", line: "" };
  if (!zone || zone.status === "no_zone") {
    return { verdict: "SET ZONE", line: "No buy band written down for this name, so there is no price to judge today against." };
  }
  const t = trend?.label ?? "SIDEWAYS";
  const falling = t === "DOWNTREND" || t === "WEAKENING";
  const stage = (): string => {
    if (!dip || dip.auc < RECORD_FLOOR) return "";
    if (dip.p >= 0.55) return ` Stage it: the dip model (record AUC ${dip.auc.toFixed(2)}) gives ${odds(dip.p)} odds of a ${DIP_PCT}% lower price within ${dip.horizon} sessions, so half now and half on the dip.`;
    if (dip.p <= 0.35) return ` Take it in one go: dip odds are only ${odds(dip.p)} (record AUC ${dip.auc.toFixed(2)}).`;
    return "";
  };
  if (zone.status === "sell") {
    return { verdict: "TRIM", line: "In your sell band. Not a day to add; the sell rules on the Plan page take it from here." };
  }
  if (zone.status === "buy") {
    if (falling) {
      return {
        verdict: "WAIT",
        line: `At your price, but the trend is ${t.toLowerCase()}: price under its ${t === "DOWNTREND" ? "50 and 200" : "50"}-day average. The band says yes and the chart says it has not stopped falling. Let it close back above the 50-day first.`,
      };
    }
    return { verdict: "BUY", line: `At your price and not falling: ${t.toLowerCase()}. Band and trend agree. The Plan page sizes it against your target weight.${stage()}` };
  }
  if (zone.price != null && zone.buyZoneLow != null && zone.price < zone.buyZoneLow) {
    return {
      verdict: falling ? "WAIT" : "BUY",
      line: falling
        ? "Below your whole buy band and still falling. Cheaper than planned is not a reason to catch it mid-fall."
        : `Below your whole buy band and the fall has stopped. Cheaper than you planned for.${stage()}`,
    };
  }
  return { verdict: "HOLD", line: `Above your buy band${trend ? ` and ${t.toLowerCase()}` : ""}. Nothing to add at this price; the position stands.` };
}

function recordWords(m: TargetMetrics): string {
  return `AUC ${m.auc.toFixed(2)}, ${describeAuc(m.auc)}`;
}

function captionFor(item: Omit<ReportItem, "png" | "caption">, rec: ModelRecord | null): string {
  const lines = [`<b>${item.title}</b>  ${item.last.toLocaleString("en-PK", { maximumFractionDigits: 2 })}  (${pct(item.dayChangePct, 2)} on the day)`];
  if (item.trend) lines.push(`Trend: ${item.trend.line}`);
  const facts: string[] = [];
  if (item.relative) facts.push(`vs KSE-100 over 20 sessions ${pct(item.relative.rel20Pct)} (rank ${item.relative.rank} of ${item.relative.of})`);
  if (item.vol) facts.push(`volatility ${item.vol.pct.toFixed(0)}% annualised${item.vol.percentile != null ? `, calmer than ${Math.round(item.vol.percentile * 100)}% of its own year` : ""}`);
  if (facts.length) lines.push(facts.join("; ") + ".");
  if (item.forecast && rec) {
    const f = item.forecast;
    lines.push(
      `Model, ${f.horizon} sessions: up ${odds(f.up)} · beats the index ${odds(f.beat)} · ${DIP_PCT}% dip first ${odds(f.dip)}. ` +
        `Record: up ${recordWords(rec.up)}; beat ${recordWords(rec.beat)}; dip ${recordWords(rec.dip)}` +
        (rec.own ? `; on this name alone, direction AUC ${rec.own.auc.toFixed(2)} over ${rec.own.n} sessions` : "") +
        "."
    );
  }
  if (item.verdict !== "INDEX") lines.push(`<b>${item.verdict}</b> — ${item.verdictLine}`);
  return lines.join("\n").slice(0, 1024);
}

// Rebuild today's context in exactly the layout the stored model was trained
// on. If that cannot be done (a macro feed down, a changed feature list) the
// report goes out without forecasts rather than with forecasts on the wrong
// inputs.
async function contextFor(model: StoredQuantModel, bars: Map<string, EodBar[]>, index: EodBar[]): Promise<{ context: Map<string, number[]> | null; reason: string }> {
  const wantMarket = model.contextNames.some((n) => (MARKET_CONTEXT_NAMES as readonly string[]).includes(n));
  const wantMacro = model.contextNames.some((n) => (MACRO_CONTEXT_NAMES as readonly string[]).includes(n));
  if (!wantMarket && !wantMacro) return { context: new Map(), reason: "" };
  const dates = index.map((b) => b.date);
  const stockBars = new Map([...bars].filter(([s]) => !TRAIN_INDICES.includes(s) && model.universe.includes(s)));
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
  const [board, summary, model, plan, inflation, sbp, long] = await Promise.all([
    getZoneBoard().catch(() => null),
    getPortfolioSummary().catch(() => null),
    loadQuantModel().catch(() => null),
    assemblePlan().catch(() => null),
    getInflationLive().catch(() => null),
    getSbpLive().catch(() => null),
    loadQuantSnapshot<LongValidation>("quant:validation:long").catch(() => null),
  ]);
  const zoneBySymbol = new Map((board?.rows ?? []).map((r) => [r.symbol, r]));
  const posBySymbol = new Map((summary?.positions ?? []).filter((p) => p.shares > 0).map((p) => [p.symbol, p]));
  const held = [...posBySymbol.keys()];

  const symbols = [...new Set([...TRAIN_INDICES, ...(model?.universe ?? []), ...held])];
  const bars = await loadBars(symbols, mongoBarsCache(6), 4);
  const index = bars.get("KSE100") ?? [];

  // The model's inputs for today, or a reason there are none.
  let context: Map<string, number[]> | null = null;
  let noModelReason = "";
  if (!model) noModelReason = "no trained model in the store yet; the weekly training job writes one";
  else if (index.length < 300) noModelReason = "not enough index history to build features";
  else {
    const c = await contextFor(model, bars, index);
    context = c.context;
    noModelReason = c.reason;
  }
  const rec: ModelRecord | null =
    model?.validation && model.validation.targets.length >= 3
      ? { up: model.validation.targets[0], beat: model.validation.targets[1], dip: model.validation.targets[2], own: null, from: model.validation.from, to: model.validation.to, names: model.validation.symbols }
      : null;
  const ownRecord = (symbol: string): SymbolMetrics | null => model?.validation?.perSymbol.find((p) => p.symbol === symbol) ?? null;

  // Where each name's 20-session return sits against the rest of the universe.
  const relTable: Array<{ symbol: string; rel: number }> = [];
  for (const [s, b] of bars) {
    if (TRAIN_INDICES.includes(s)) continue;
    const r = relativeReturn(b, index, 20);
    if (r != null) relTable.push({ symbol: s, rel: r });
  }
  relTable.sort((a, b) => b.rel - a.rel);

  const forecastFor = (symbol: string, b: EodBar[]): Forecast | null => {
    if (!model || !context || noModelReason) return null;
    try {
      const rows = buildFeatures(b, index, model.horizon, context);
      const last = rows[rows.length - 1];
      if (!last || last.x.length !== model.featureNames.length) return null;
      const p = predictEnsemble(model.learners, last.x);
      return { up: p[0], beat: p[1], dip: p[2], horizon: model.horizon };
    } catch {
      return null;
    }
  };

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
    const forecast = forecastFor(symbol, b);
    const ownRec = ownRecord(symbol);
    const itemRec: ModelRecord | null = rec ? { ...rec, own: ownRec } : null;

    const relIdx = relTable.findIndex((r) => r.symbol === symbol);
    const relative = heldName && relIdx >= 0 ? { rel20Pct: relTable[relIdx].rel * 100, rank: relIdx + 1, of: relTable.length } : null;
    const volPct = heldName ? realisedVolPct(b, 20) : null;
    const vol = volPct != null ? { pct: volPct, percentile: volPercentile(b, 20, 250) } : null;

    const { verdict, line: verdictLine } = verdictFor(
      zone ? { status: zone.status, buyZoneLow: zone.buyZoneLow, buyZoneHigh: zone.buyZoneHigh, price: zone.price } : undefined,
      trend,
      heldName,
      forecast && rec ? { p: forecast.dip, auc: rec.dip.auc, horizon: forecast.horizon } : null
    );

    const png = renderPriceChart({
      title,
      subtitle: trend ? trend.short : undefined,
      bars: window,
      ma50: m50.slice(from),
      ma200: m200.slice(from),
      buyZone: zone ? { low: zone.buyZoneLow, high: zone.buyZoneHigh } : undefined,
      sellZone: zone ? { low: zone.sellZoneLow, high: zone.sellZoneHigh } : undefined,
      avgCost: pos?.avgCost ?? null,
      footer: `LAST ${last.close.toFixed(2)}  ${pct(dayChangePct, 2)} ON THE DAY${heldName && verdict !== "INDEX" ? `   ${verdict}` : ""}`,
    });

    const base = { symbol, title, trend, verdict, verdictLine, forecast, last: last.close, dayChangePct, relative, vol };
    return { ...base, png, caption: captionFor(base, itemRec) };
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
  const rank: Record<Verdict, number> = { BUY: 0, WAIT: 1, TRIM: 2, HOLD: 3, "SET ZONE": 4, INDEX: 5 };
  holdings.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.symbol.localeCompare(b.symbol));

  // --- the market, in words -------------------------------------------------
  const idxLine = indices
    .map((i) => `${i.title} ${i.last.toLocaleString("en-PK", { maximumFractionDigits: 0 })} (${pct(i.dayChangePct, 2)})${i.trend ? ", " + i.trend.label.toLowerCase() : ""}`)
    .join("\n");
  const universeBars = new Map([...bars].filter(([s]) => !TRAIN_INDICES.includes(s) && (model?.universe.includes(s) ?? true)));
  const br = breadthNow(universeBars);
  const breadthLine =
    br.names >= 20
      ? `Breadth across ${br.names} names: ${br.above50Pct.toFixed(0)}% above their 50-day, ${br.above200Pct.toFixed(0)}% above their 200-day, ${br.adv20Pct.toFixed(0)}% up over 20 sessions.`
      : "";
  const regime = plan?.regime;
  const regimeLine = regime ? `Regime: ${regime.label} (score ${regime.rawScore >= 0 ? "+" : ""}${regime.rawScore} of ${regime.maxScore}); the playbook's cash floor for it is ${regime.cashFloorPct}%.` : "";

  const macroBars = await loadMacro(mongoBarsCache(24)).catch(() => null);
  const macroBits: string[] = [];
  const m = (k: MacroKey, days: number) => (macroBars ? macroRead(macroBars.get(k) ?? [], days) : null);
  const pkr = m("usdpkr", 28), oil = m("oil", 28);
  if (pkr) macroBits.push(`USD/PKR ${pkr.last.toFixed(1)} (${pct(pkr.changePct)} in 4 weeks)`);
  if (oil) macroBits.push(`WTI $${oil.last.toFixed(0)} (${pct(oil.changePct)} in 4 weeks)`);
  const cpi = inflation?.yoyPct ?? null;
  const policy = sbp?.rates?.policyRatePct ?? null;
  if (cpi != null) macroBits.push(`CPI ${cpi.toFixed(1)}% YoY${inflation?.latest?.period ? ` (${inflation.latest.period})` : ""}`);
  if (policy != null) macroBits.push(`policy rate ${policy}%${cpi != null ? `, real ${pct(policy - cpi)}` : ""}`);
  const tb = sbp?.rates?.mtbCutoffs?.find((t: any) => t.tenor === "12M")?.yieldPct;
  if (tb != null) macroBits.push(`12M T-bill ${Number(tb).toFixed(2)}%`);
  const macroLine = macroBits.length ? `Pakistan: ${macroBits.join("; ")}.` : "";

  // --- the model, in words --------------------------------------------------
  let modelNote: string;
  const kse = indices.find((i) => i.symbol === "KSE100");
  if (!model) {
    modelNote = "Model: none trained yet. The weekly training job (Saturday 06:30) writes one; until then the bands and the trend are the signal.";
  } else if (noModelReason) {
    modelNote = `Model: no forecasts today, ${noModelReason}. The bands and the trend still stand.`;
  } else if (!rec) {
    modelNote = "Model: trained, but without a walk-forward record; its odds are printed without a measure of what they are worth, so treat them as decoration.";
  } else {
    const learners = model.learners.map((l) => l.kind).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
    const what = Object.entries(learners).map(([k, n]) => `${n} ${k === "gbm" ? "boosted-tree" : "network"} model${n > 1 ? "s" : ""}`).join(" and ");
    const kseRec = ownRecord("KSE100");
    const parts = [
      `<b>Model</b>: ${what}, trained on ${model.universe.length} names to ${model.trainedTo}, ${model.horizon} sessions ahead, with market breadth${model.contextNames.some((n) => n.startsWith("pkr")) ? ", the rupee, oil and global risk" : ""} as context.`,
      `Walk-forward record ${rec.from} to ${rec.to}: direction ${recordWords(rec.up)} (skill ${pct(rec.up.skill)} against always-up); relative ranking ${recordWords(rec.beat)}; ${DIP_PCT}% dip ${recordWords(rec.dip)}.`,
    ];
    if (kse?.forecast) {
      parts.push(
        `KSE-100: ${odds(kse.forecast.up)} odds of being higher in ${kse.forecast.horizon} sessions, ${odds(kse.forecast.dip)} odds of a ${DIP_PCT}% dip first` +
          (kseRec ? ` (on the index alone: direction AUC ${kseRec.auc.toFixed(2)}, dip AUC ${kseRec.aucDip.toFixed(2)}, ${kseRec.n} sessions)` : "") +
          "."
      );
    }
    if (long?.summary?.targets?.length) {
      const t = long.summary.targets;
      parts.push(`Long test, ${long.years}, ${long.names} names, no survivorship bias: direction AUC ${t[0].auc.toFixed(2)}, relative ${t[1].auc.toFixed(2)}, dip ${t[2].auc.toFixed(2)}, rank IC ${long.summary.icRel.mean >= 0 ? "+" : ""}${long.summary.icRel.mean.toFixed(3)} (t ${long.summary.icRel.tStat.toFixed(1)}).`);
    }
    const dirWords = rec.up.auc >= RECORD_FLOOR ? "a modest tilt worth reading" : "a coin toss: read them as noise";
    const dipWords = rec.dip.auc >= RECORD_FLOOR ? "carry real information and are used to stage buys" : "are too weak to act on";
    parts.push(`<i>Read the direction odds as ${dirWords}; the dip odds ${dipWords}. The bands and the trend remain the signal.</i>`);
    modelNote = parts.join("\n");
  }

  const buys = holdings.filter((h) => h.verdict === "BUY").map((h) => h.symbol);
  const waits = holdings.filter((h) => h.verdict === "WAIT").map((h) => h.symbol);
  const trims = holdings.filter((h) => h.verdict === "TRIM").map((h) => h.symbol);
  // The ranking line is only worth the space when the ranking has a record.
  const ranked = holdings.filter((h) => h.forecast).sort((a, b) => b.forecast!.beat - a.forecast!.beat);
  const bestLine =
    ranked.length && rec && rec.beat.auc >= 0.53
      ? `<b>Model's order among your names</b> (odds of beating the index, ${ranked[0].forecast!.horizon} sessions; record ${recordWords(rec.beat)}): ${ranked.map((h) => `${h.symbol} ${odds(h.forecast!.beat)}`).join(", ")}.`
      : "";

  const summaryLines = [
    `<b>Charts for ${today}</b>`,
    idxLine,
    breadthLine,
    regimeLine,
    macroLine,
    "",
    modelNote,
    "",
    buys.length ? `<b>Add today:</b> ${buys.join(", ")} — at your price and not falling.` : "<b>Add today:</b> nothing. No held name is both at your price and out of its fall.",
    waits.length ? `<b>At your price but still falling:</b> ${waits.join(", ")}. Wait for a close back above the 50-day.` : "",
    trims.length ? `<b>In a sell band:</b> ${trims.join(", ")}.` : "",
    bestLine,
  ].filter((l) => l !== "");

  return {
    date: today,
    indices,
    holdings,
    summary: summaryLines.join("\n").slice(0, 4096),
    modelNote,
    model: model ? { trainedOn: model.trainedOn, horizon: model.horizon, names: model.universe.length, learners: model.learners.map((l) => l.kind).join("+") } : null,
  };
}
