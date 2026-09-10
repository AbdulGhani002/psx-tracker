// The daily chart report: one picture per index and per holding, a trend read
// under each, the model's odds turned into levels, and a verdict on whether
// today is a day to add to a position you already own.
//
// The verdict is the useful part and it is deliberately simple. Your buy zone
// says whether the PRICE is right; the trend says whether the price is still
// falling. Both have to agree before it says buy. The model earns a voice in
// the verdict only where its walk-forward record says it has one, which today
// is the dip odds: when they are high, a buy is staged rather than taken.
//
// Two texts come out: `summary`, short enough for a phone, and `detail`, the
// long form with the model's record, which goes into the weekly email. The
// model itself is trained on Abdul's machine and read here from the feed
// store. Nothing in this file trains anything.

import "server-only";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import { getZoneBoard, getPortfolioSummary, getInflationLive, getSbpLive } from "@/lib/data";
import { assemblePlan } from "@/lib/plan";
import { uid } from "@/lib/auth/uid";
import { renderPriceChart, sma } from "@/lib/charts/price-chart";
import { readTrend, relativeReturn, realisedVolPct, volPercentile, DIP_PCT, type TrendRead } from "@/lib/quant/features";
import { buildPanel, predictEnsemble, describeAuc, type TargetMetrics, type SymbolMetrics, type PanelRow } from "@/lib/quant/panel";
import { marketContext, macroContext, mergeContext, breadthNow, MARKET_CONTEXT_NAMES, MACRO_CONTEXT_NAMES } from "@/lib/quant/context";
import { loadMacro, macroRead, type MacroKey } from "@/lib/timeseries/macro";
import { loadBars, TRAIN_INDICES } from "@/lib/quant/universe";
import { loadQuantModel, loadQuantSnapshot, saveQuantSnapshot, mongoBarsCache, type StoredQuantModel } from "@/lib/quant/store";
import { projectLevels, projectionLine, levelsLine, modelBands, bandsLine, type Projection, type ModelBands } from "@/lib/quant/projection";

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
  projection: Projection | null;
  bands: ModelBands | null;
  last: number;
  dayChangePct: number;
  relative: { rel20Pct: number; rank: number; of: number } | null;
  vol: { pct: number; percentile: number | null } | null;
};

export type QuantReport = {
  date: string;
  indices: ReportItem[];
  holdings: ReportItem[];
  summary: string; // short, for the phone
  detail: string; // long, for the weekly email
  modelNote: string;
  model: { trainedOn: string; horizon: number; names: number; learners: string } | null;
};

type LongValidation = { years: string; names: number; rows: number; summary: { targets: TargetMetrics[]; ic: { mean: number }; icRel: { mean: number; tStat: number } } };

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const odds = (p: number) => `${Math.round(p * 100)}%`;
const money = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

// The model gets a say in the verdict only through a target whose record is
// at least "real but modest".
const RECORD_FLOOR = 0.58;

function verdictFor(
  zone: { status: string; buyZoneLow: number | null; buyZoneHigh: number | null; price: number | null } | undefined,
  trend: TrendRead | null,
  held: boolean,
  dip: { p: number; auc: number; horizon: number } | null,
  bands: ModelBands | null
): { verdict: Verdict; line: string } {
  if (!held) return { verdict: "INDEX", line: "" };
  if (!zone || zone.status === "no_zone") {
    return {
      verdict: "SET ZONE",
      line: `No buy band written down for this name.${bands ? ` The model's bands are ${bandsLine(bands)}; write yours on the Plan page, or take these.` : ""}`,
    };
  }
  const t = trend?.label ?? "SIDEWAYS";
  const falling = t === "DOWNTREND" || t === "WEAKENING";
  const stage = (): string => {
    if (!dip || dip.auc < RECORD_FLOOR) return "";
    if (dip.p >= 0.55) return ` Stage it: ${odds(dip.p)} odds of a ${DIP_PCT}% lower price within ${dip.horizon} sessions, so half now and half on the dip.`;
    if (dip.p <= 0.35) return ` Take it in one go: dip odds are only ${odds(dip.p)}.`;
    return "";
  };
  if (zone.status === "sell") {
    return { verdict: "TRIM", line: "In your sell band. Not a day to add; the sell rules on the Plan page take it from here." };
  }
  if (zone.status === "buy") {
    if (falling) {
      return { verdict: "WAIT", line: `At your price, but ${t.toLowerCase()}: under its ${t === "DOWNTREND" ? "50 and 200" : "50"}-day average. Let it close back above the 50-day first.` };
    }
    return { verdict: "BUY", line: `At your price and not falling (${t.toLowerCase()}). The Plan page sizes it.${stage()}` };
  }
  if (zone.price != null && zone.buyZoneLow != null && zone.price < zone.buyZoneLow) {
    return {
      verdict: falling ? "WAIT" : "BUY",
      line: falling ? "Below your whole buy band and still falling. Cheaper than planned is not a reason to catch it mid-fall." : `Below your whole buy band and the fall has stopped.${stage()}`,
    };
  }
  return { verdict: "HOLD", line: `Above your buy band${trend ? `, ${t.toLowerCase()}` : ""}. Nothing to add at this price.` };
}

const recordWords = (m: TargetMetrics) => `AUC ${m.auc.toFixed(2)}, ${describeAuc(m.auc)}`;

function yourBands(zone: { buyZoneLow: number | null; buyZoneHigh: number | null; sellZoneLow: number | null; sellZoneHigh: number | null } | undefined): string {
  if (!zone) return "";
  const b = zone.buyZoneHigh != null ? `buy ${zone.buyZoneLow != null ? money(zone.buyZoneLow) + " to " : "up to "}${money(zone.buyZoneHigh)}` : "";
  const s = zone.sellZoneLow != null ? `sell ${money(zone.sellZoneLow)}${zone.sellZoneHigh != null ? " to " + money(zone.sellZoneHigh) : "+"}` : "";
  return [b, s].filter(Boolean).join(", ");
}

// Short captions: what it is, where it is going, what to do.
function captionFor(item: Omit<ReportItem, "png" | "caption">, rec: ModelRecord | null, yours: string): string {
  const head = `<b>${item.title}</b>  ${money(item.last)}  (${pct(item.dayChangePct, 2)})${item.trend ? ` · ${item.trend.label.toLowerCase()}` : ""}${item.relative ? ` · rank ${item.relative.rank} of ${item.relative.of} on 20d strength` : ""}`;
  const lines = [head];
  if (item.verdict === "INDEX") {
    if (item.projection) lines.push(projectionLine(item.projection), levelsLine(item.projection));
    if (rec) lines.push(`Record: direction ${recordWords(rec.up)}; dip ${recordWords(rec.dip)}.`);
  } else {
    if (item.forecast && item.projection) {
      const f = item.forecast;
      lines.push(`Odds, ${f.horizon} sessions: higher ${odds(f.up)} · beats index ${odds(f.beat)} · ${DIP_PCT}% dip first ${odds(f.dip)}. Centre ${money(item.projection.median)}, range ${money(item.projection.low)} to ${money(item.projection.high)}.`);
    }
    if (item.bands) lines.push(`Model bands: ${bandsLine(item.bands)}${yours ? ` (yours: ${yours})` : ""}.`);
    lines.push(`<b>${item.verdict}</b> — ${item.verdictLine}`);
  }
  return lines.filter(Boolean).join("\n").slice(0, 1024);
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
  const [board, portfolio, model, plan, inflation, sbp, long, userId] = await Promise.all([
    getZoneBoard().catch(() => null),
    getPortfolioSummary().catch(() => null),
    loadQuantModel().catch(() => null),
    assemblePlan().catch(() => null),
    getInflationLive().catch(() => null),
    getSbpLive().catch(() => null),
    loadQuantSnapshot<LongValidation>("quant:validation:long").catch(() => null),
    uid().catch(() => ""),
  ]);
  const zoneBySymbol = new Map((board?.rows ?? []).map((r) => [r.symbol, r]));
  const posBySymbol = new Map((portfolio?.positions ?? []).filter((p) => p.shares > 0).map((p) => [p.symbol, p]));
  const held = [...posBySymbol.keys()];

  const symbols = [...new Set([...TRAIN_INDICES, ...(model?.universe ?? []), ...held])];
  const bars = await loadBars(symbols, mongoBarsCache(6), 4);
  const index = bars.get("KSE100") ?? [];

  // The model's inputs for today come out of the same panel builder that
  // trained it, so the features (ranks included) are the trained layout.
  const lastRows = new Map<string, PanelRow>();
  let noModelReason = "";
  if (!model) noModelReason = "no trained model in the store yet";
  else if (index.length < 300) noModelReason = "not enough index history to build features";
  else {
    const c = await contextFor(model, bars, index);
    noModelReason = c.reason;
    if (c.context) {
      const panel = buildPanel(bars, index, model.horizon, { context: c.context, ranks: (model.rankNames ?? []).length > 0, minRows: 1 });
      for (const r of panel.rows) lastRows.set(r.symbol, r);
    }
  }
  const rec: ModelRecord | null =
    model?.validation && model.validation.targets.length >= 3
      ? { up: model.validation.targets[0], beat: model.validation.targets[1], dip: model.validation.targets[2], own: null, from: model.validation.from, to: model.validation.to, names: model.validation.symbols }
      : null;
  const ownRecord = (symbol: string): SymbolMetrics | null => model?.validation?.perSymbol.find((p) => p.symbol === symbol) ?? null;

  const relTable: Array<{ symbol: string; rel: number }> = [];
  for (const [s, b] of bars) {
    if (TRAIN_INDICES.includes(s)) continue;
    const r = relativeReturn(b, index, 20);
    if (r != null) relTable.push({ symbol: s, rel: r });
  }
  relTable.sort((a, b) => b.rel - a.rel);

  const forecastFor = (symbol: string): Forecast | null => {
    if (!model || noModelReason) return null;
    const last = lastRows.get(symbol);
    if (!last || last.x.length !== model.featureNames.length) return null;
    try {
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
    const forecast = forecastFor(symbol);
    const projection = forecast ? projectLevels(b, forecast.horizon, forecast.up, forecast.dip, DIP_PCT) : null;
    const bands = heldName && projection ? modelBands(projection) : null;
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
      forecast && rec ? { p: forecast.dip, auc: rec.dip.auc, horizon: forecast.horizon } : null,
      bands
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
      projection: projection ? { horizon: projection.horizon, median: projection.median, low: projection.low, high: projection.high, dipLevel: projection.dipLevel } : null,
      footer: `LAST ${last.close.toFixed(2)}  ${pct(dayChangePct, 2)} ON THE DAY${heldName && verdict !== "INDEX" ? `   ${verdict}` : ""}${projection ? `   MODEL ${odds(projection.pUp)} HIGHER IN ${projection.horizon}D` : ""}`,
    });

    const base = { symbol, title, trend, verdict, verdictLine, forecast, projection, bands, last: last.close, dayChangePct, relative, vol };
    return { ...base, png, caption: captionFor(base, itemRec, yourBands(zone)) };
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

  // The model's bands, kept where the app can show them later.
  if (userId && holdings.some((h) => h.bands)) {
    await saveQuantSnapshot(
      `quant:zones:${userId}`,
      { at: today, horizon: model?.horizon ?? null, bands: holdings.filter((h) => h.bands).map((h) => ({ symbol: h.symbol, ...h.bands!, centre: h.projection!.median, low: h.projection!.low, high: h.projection!.high })) },
      `${holdings.filter((h) => h.bands).length} names`
    ).catch(() => {});
  }

  // --- the market, in words ---------------------------------------------------
  const kse = indices.find((i) => i.symbol === "KSE100");
  const idxShort = indices.map((i, k) => (k === 0 ? `${i.title} ${money(i.last)} (${pct(i.dayChangePct)})${i.trend ? " " + i.trend.label.toLowerCase() : ""}` : `${i.title} ${pct(i.dayChangePct)}`)).join(" · ");
  const idxLong = indices.map((i) => `${i.title} ${money(i.last)} (${pct(i.dayChangePct, 2)})${i.trend ? ", " + i.trend.line : ""}`).join("\n");
  const universeBars = new Map([...bars].filter(([s]) => !TRAIN_INDICES.includes(s) && (model?.universe.includes(s) ?? true)));
  const br = breadthNow(universeBars);
  const breadthShort = br.names >= 20 ? `Breadth: ${br.above50Pct.toFixed(0)}% above 50d, ${br.above200Pct.toFixed(0)}% above 200d.` : "";
  const breadthLong = br.names >= 20 ? `Breadth across ${br.names} names: ${br.above50Pct.toFixed(0)}% above their 50-day, ${br.above200Pct.toFixed(0)}% above their 200-day, ${br.adv20Pct.toFixed(0)}% up over 20 sessions.` : "";
  const regime = plan?.regime;
  const regimeShort = regime ? `Regime ${regime.label}, cash floor ${regime.cashFloorPct}%.` : "";
  const regimeLong = regime ? `Regime: ${regime.label} (score ${regime.rawScore >= 0 ? "+" : ""}${regime.rawScore} of ${regime.maxScore}); the playbook's cash floor for it is ${regime.cashFloorPct}%.` : "";

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

  // --- the model, in words ------------------------------------------------------
  let modelNote: string;
  let modelShort = "";
  if (!model) {
    modelNote = "Model: none trained yet. Until then the bands and the trend are the signal.";
  } else if (noModelReason) {
    modelNote = `Model: no forecasts today, ${noModelReason}. The bands and the trend still stand.`;
  } else if (!rec) {
    modelNote = "Model: trained, but without a walk-forward record; treat its odds as decoration.";
  } else {
    const learners = model.learners.map((l) => l.kind).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
    const what = Object.entries(learners).map(([k, n]) => `${n} ${k === "gbm" ? "boosted-tree" : "network"} model${n > 1 ? "s" : ""}`).join(" and ");
    const kseRec = ownRecord("KSE100");
    const parts = [
      `<b>Model</b>: ${what}, trained on ${model.universe.length} names to ${model.trainedTo}, ${model.horizon} sessions ahead, with market breadth${model.contextNames.some((n) => n.startsWith("pkr")) ? ", the rupee, oil and global risk" : ""} as context${(model.rankNames ?? []).length ? " and each name's rank among the others" : ""}.`,
      `Walk-forward record ${rec.from} to ${rec.to}: direction ${recordWords(rec.up)} (skill ${pct(rec.up.skill)} against always-up); relative ranking ${recordWords(rec.beat)}; ${DIP_PCT}% dip ${recordWords(rec.dip)}.`,
    ];
    if (kse?.projection) {
      parts.push(`KSE-100: ${projectionLine(kse.projection)} ${levelsLine(kse.projection)}${kseRec ? ` On the index alone the record is direction AUC ${kseRec.auc.toFixed(2)}, dip AUC ${kseRec.aucDip.toFixed(2)} over ${kseRec.n} sessions.` : ""}`);
      const longT = long?.summary?.targets;
      const recordShort = longT?.length
        ? `5y record ${rec.up.auc.toFixed(2)} direction / ${rec.dip.auc.toFixed(2)} dip, 24y ${longT[0].auc.toFixed(2)} / ${longT[2].auc.toFixed(2)}`
        : `record ${rec.up.auc.toFixed(2)} direction / ${rec.dip.auc.toFixed(2)} dip`;
      modelShort = `Model (${recordShort}): KSE-100 ${projectionLine(kse.projection).replace(/^Next \d+ sessions: /, "")}`;
    }
    if (long?.summary?.targets?.length) {
      const t = long.summary.targets;
      parts.push(`Long test, ${long.years}, ${long.names} names, no survivorship bias: direction AUC ${t[0].auc.toFixed(2)}, relative ${t[1].auc.toFixed(2)}, dip ${t[2].auc.toFixed(2)}, rank IC ${long.summary.icRel.mean >= 0 ? "+" : ""}${long.summary.icRel.mean.toFixed(3)} (t ${long.summary.icRel.tStat.toFixed(1)}).`);
    }
    const ups = holdings.map((h) => h.forecast?.up).filter((v): v is number => v != null);
    if (ups.length >= 3 && Math.max(...ups) - Math.min(...ups) < 0.03) {
      parts.push(`The direction odds barely differ from name to name today (${odds(Math.min(...ups))} to ${odds(Math.max(...ups))}): the model is saying the market, not the name, decides the next ${model.horizon} sessions.`);
    }
    // Twenty-four years outrank five. When the long test says coin toss, the
    // recent record is called what it is: unproven.
    const longUp = long?.summary?.targets?.[0]?.auc ?? null;
    const longDip = long?.summary?.targets?.[2]?.auc ?? null;
    const dirWords =
      longUp != null && longUp < 0.53
        ? `unproven: a modest tilt over the last five years (AUC ${rec.up.auc.toFixed(2)}) but a coin toss over twenty-four (${longUp.toFixed(2)})`
        : rec.up.auc >= RECORD_FLOOR
        ? "a modest tilt worth reading"
        : "a coin toss: read them as noise";
    const dipWords =
      rec.dip.auc >= RECORD_FLOOR
        ? `carry real information over the last five years and are used to stage buys${longDip != null && longDip < 0.56 ? ` (over twenty-four years the edge is slighter, ${longDip.toFixed(2)})` : ""}`
        : "are too weak to act on";
    parts.push(`<i>Read the direction odds as ${dirWords}; the dip odds ${dipWords}. The bands and the trend remain the signal.</i>`);
    modelNote = parts.join("\n");
  }

  const buys = holdings.filter((h) => h.verdict === "BUY").map((h) => h.symbol);
  const waits = holdings.filter((h) => h.verdict === "WAIT").map((h) => h.symbol);
  const trims = holdings.filter((h) => h.verdict === "TRIM").map((h) => h.symbol);
  const unset = holdings.filter((h) => h.verdict === "SET ZONE").map((h) => h.symbol);
  const actionShort = [
    buys.length ? `Add today: ${buys.join(", ")}.` : "Add today: nothing.",
    waits.length ? `At your price but falling: ${waits.join(", ")}.` : "",
    trims.length ? `In a sell band: ${trims.join(", ")}.` : "",
    unset.length ? `No band written for ${unset.join(", ")} (model bands in the caption).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Over twenty-four years the one durable thing the model does is rank
  // names against each other. When the long test says so (rank IC with a
  // t-statistic of at least 3), that order goes in the short message.
  const longIc = long?.summary?.icRel ?? null;
  const rankedNames = holdings.filter((h) => h.forecast).sort((a, b) => b.forecast!.beat - a.forecast!.beat);
  const rankShort =
    longIc && longIc.tStat >= 3 && rankedNames.length >= 2
      ? `Model's order (24y rank IC ${longIc.mean >= 0 ? "+" : ""}${longIc.mean.toFixed(2)}, t ${longIc.tStat.toFixed(1)}): ${rankedNames.map((h) => `${h.symbol} ${odds(h.forecast!.beat)}`).join(" · ")}.`
      : "";

  const summary = [`<b>Charts ${today}</b>`, idxShort, [breadthShort, regimeShort].filter(Boolean).join(" "), modelShort, actionShort, rankShort, macroShort]
    .filter((l) => l !== "")
    .join("\n")
    .slice(0, 4096);

  const holdingLines = holdings.map((h) => {
    const bits = [`${h.symbol} ${money(h.last)} (${pct(h.dayChangePct)})${h.trend ? `, ${h.trend.label.toLowerCase()}` : ""}`];
    if (h.forecast) bits.push(`odds higher ${odds(h.forecast.up)}, beats index ${odds(h.forecast.beat)}, dip first ${odds(h.forecast.dip)}`);
    if (h.bands) bits.push(`model bands ${bandsLine(h.bands)}`);
    bits.push(`${h.verdict}: ${h.verdictLine}`);
    return bits.join(". ");
  });
  const detail = [
    `Charts for ${today}`,
    idxLong,
    breadthLong,
    regimeLong,
    macroLong.length ? `Pakistan: ${macroLong.join("; ")}.` : "",
    "",
    modelNote.replace(/<\/?[bi]>/g, ""),
    "",
    buys.length ? `Add today: ${buys.join(", ")} — at your price and not falling.` : "Add today: nothing. No held name is both at your price and out of its fall.",
    waits.length ? `At your price but still falling: ${waits.join(", ")}. Wait for a close back above the 50-day.` : "",
    trims.length ? `In a sell band: ${trims.join(", ")}.` : "",
    "",
    ...holdingLines,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    date: today,
    indices,
    holdings,
    summary,
    detail,
    modelNote,
    model: model ? { trainedOn: model.trainedOn, horizon: model.horizon, names: model.universe.length, learners: model.learners.map((l) => l.kind).join("+") } : null,
  };
}
