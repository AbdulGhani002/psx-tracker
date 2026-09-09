// The daily chart report: one picture per index and per holding, a trend read
// under each, the model's number beside its measured skill, and a verdict on
// whether today is a day to add to a position you already own.
//
// The verdict is the useful part and it is deliberately simple. Your buy zone
// says whether the PRICE is right; the trend says whether the price is still
// falling. Both have to agree before it says buy. A name inside its band and
// in a downtrend is a knife, and the one thing this report is for is to stop
// you catching it because the band said so.
//
// The neural network's forecast is included because it was asked for, and its
// out-of-sample skill is printed next to it every single time so nobody has to
// remember how little it is worth. Skill is accuracy minus the best naive
// baseline; zero means a coin toss.

import "server-only";
import { fetchEodBars, type EodBar } from "@/lib/timeseries/psx-eod";
import { getZoneBoard, getPortfolioSummary, getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { renderPriceChart, sma } from "@/lib/charts/price-chart";
import { buildFeatures, readTrend, type TrendRead } from "@/lib/quant/features";
import { walkForward, latestForecast, describeForecast, DEFAULT_WALK, type WalkResult } from "@/lib/quant/walkforward";

export const INDICES: Array<{ symbol: string; title: string }> = [
  { symbol: "KSE100", title: "KSE-100" },
  { symbol: "KMI30", title: "KMI-30" },
  { symbol: "KSE30", title: "KSE-30" },
];

export type Verdict = "BUY" | "WAIT" | "HOLD" | "TRIM" | "SET ZONE" | "INDEX";

export type ReportItem = {
  symbol: string;
  title: string;
  png: Buffer;
  caption: string;
  trend: TrendRead | null;
  verdict: Verdict;
  verdictLine: string;
  forecast: { p: number; skill: number } | null;
  last: number;
  dayChangePct: number;
};

export type QuantReport = {
  date: string;
  indices: ReportItem[];
  holdings: ReportItem[];
  summary: string;
  skillNote: string;
};

type SkillCache = { date: string; skill: number; accuracy: number; baseline: number; n: number; edge: number };

// The walk-forward is the slow part and it changes by one session a day, so
// it is recomputed at most once per symbol per day and kept in the feed store.
async function skillFor(symbol: string, rows: ReturnType<typeof buildFeatures>, today: string): Promise<SkillCache | null> {
  const key = `quant:skill:${symbol}`;
  const cached = await getFeedSnapshot<SkillCache>(key).catch(() => null);
  if (cached?.data && cached.data.date === today) return cached.data;
  const wf: WalkResult | null = walkForward(rows, DEFAULT_WALK);
  if (!wf) return null;
  const out: SkillCache = { date: today, skill: wf.skill, accuracy: wf.accuracy, baseline: wf.naiveBest, n: wf.n, edge: wf.edgePct };
  await saveFeedSnapshot(key, out, "ok", `${wf.n} oos days`).catch(() => {});
  return out;
}

function verdictFor(
  zone: { status: string; buyZoneLow: number | null; buyZoneHigh: number | null; price: number | null } | undefined,
  trend: TrendRead | null,
  held: boolean
): { verdict: Verdict; line: string } {
  if (!held) return { verdict: "INDEX", line: "" };
  if (!zone || zone.status === "no_zone") {
    return { verdict: "SET ZONE", line: "No buy band written down for this name, so there is no price to judge today against." };
  }
  const t = trend?.label ?? "SIDEWAYS";
  const falling = t === "DOWNTREND" || t === "WEAKENING";
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
    return {
      verdict: "BUY",
      line: `At your price and not falling: ${t.toLowerCase()}. Band and trend agree. The Plan page sizes it against your target weight.`,
    };
  }
  // Between the bands.
  if (zone.price != null && zone.buyZoneLow != null && zone.price < zone.buyZoneLow) {
    return {
      verdict: falling ? "WAIT" : "BUY",
      line: falling
        ? "Below your whole buy band and still falling. Cheaper than planned is not a reason to catch it mid-fall."
        : "Below your whole buy band and the fall has stopped. Cheaper than you planned for.",
    };
  }
  return {
    verdict: "HOLD",
    line: `Above your buy band${trend ? ` and ${t.toLowerCase()}` : ""}. Nothing to add at this price; the position stands.`,
  };
}

function captionFor(item: Omit<ReportItem, "png" | "caption">, skillNote: string | null): string {
  const chg = `${item.dayChangePct >= 0 ? "+" : ""}${item.dayChangePct.toFixed(2)}%`;
  const lines = [`<b>${item.title}</b>  ${item.last.toLocaleString("en-PK", { maximumFractionDigits: 2 })}  (${chg} on the day)`];
  if (item.trend) lines.push(`Trend: ${item.trend.line}`);
  if (item.verdict !== "INDEX") lines.push(`<b>${item.verdict}</b> — ${item.verdictLine}`);
  if (item.forecast) lines.push(`Model: ${describeForecast(item.forecast.p, item.forecast.skill)}`);
  if (skillNote) lines.push(`<i>${skillNote}</i>`);
  return lines.join("\n");
}

export async function buildQuantReport(): Promise<QuantReport> {
  const today = new Date().toISOString().slice(0, 10);
  const [index, board, summary] = await Promise.all([
    fetchEodBars("KSE100"),
    getZoneBoard().catch(() => null),
    getPortfolioSummary().catch(() => null),
  ]);
  const zoneBySymbol = new Map((board?.rows ?? []).map((r) => [r.symbol, r]));
  const posBySymbol = new Map((summary?.positions ?? []).filter((p) => p.shares > 0).map((p) => [p.symbol, p]));

  const make = async (symbol: string, title: string, held: boolean): Promise<ReportItem | null> => {
    const bars: EodBar[] = symbol === "KSE100" ? index : await fetchEodBars(symbol);
    if (bars.length < 260) return null;
    const closes = bars.map((b) => b.close);
    const m50 = sma(closes, 50);
    const m200 = sma(closes, 200);
    const from = Math.max(0, bars.length - 260);
    const window = bars.slice(from);
    const last = window[window.length - 1];
    const prev = window[window.length - 2];
    const dayChangePct = prev ? (last.close / prev.close - 1) * 100 : 0;
    const trend = readTrend(bars);
    const zone = zoneBySymbol.get(symbol);
    const pos = posBySymbol.get(symbol);

    let forecast: ReportItem["forecast"] = null;
    if (index.length >= 300) {
      try {
        const rows = buildFeatures(bars, index, DEFAULT_WALK.horizon);
        const [skill, fc] = await Promise.all([skillFor(symbol, rows, today), Promise.resolve(latestForecast(rows, DEFAULT_WALK))]);
        if (skill && fc) forecast = { p: fc.p, skill: skill.skill };
      } catch {
        /* the chart and the trend still go out */
      }
    }

    const { verdict, line: verdictLine } = verdictFor(
      zone ? { status: zone.status, buyZoneLow: zone.buyZoneLow, buyZoneHigh: zone.buyZoneHigh, price: zone.price } : undefined,
      trend,
      held
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
      footer: `LAST ${last.close.toFixed(2)}  ${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}% ON THE DAY${held && verdict !== "INDEX" ? `   ${verdict}` : ""}`,
    });

    const base = { symbol, title, trend, verdict, verdictLine, forecast, last: last.close, dayChangePct };
    return { ...base, png, caption: captionFor(base, null) };
  };

  const indices: ReportItem[] = [];
  for (const ix of INDICES) {
    const item = await make(ix.symbol, ix.title, false);
    if (item) indices.push(item);
  }
  const holdings: ReportItem[] = [];
  for (const [symbol, pos] of posBySymbol) {
    const item = await make(symbol, `${symbol} ${pos.name ?? ""}`.trim(), true);
    if (item) holdings.push(item);
  }
  // Names with something to do first, then the rest alphabetically.
  const rank: Record<Verdict, number> = { BUY: 0, WAIT: 1, TRIM: 2, HOLD: 3, "SET ZONE": 4, INDEX: 5 };
  holdings.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.symbol.localeCompare(b.symbol));

  // One honest line about the model, computed from what it actually did.
  const skills = holdings.map((h) => h.forecast?.skill).filter((s): s is number => s != null);
  const meanSkill = skills.length ? skills.reduce((s, v) => s + v, 0) / skills.length : 0;
  const skillNote =
    skills.length === 0
      ? "Model: no out-of-sample record yet."
      : meanSkill >= 3
      ? `Model skill across your names averages +${meanSkill.toFixed(1)} points over always-guessing-up. Modest, but real.`
      : meanSkill >= -1
      ? `Model skill across your names averages ${meanSkill >= 0 ? "+" : ""}${meanSkill.toFixed(1)} points over always-guessing-up. That is a coin toss: read the percentages as noise and the trend and bands as the signal.`
      : `Model skill across your names averages ${meanSkill.toFixed(1)} points, WORSE than always guessing up. The percentages are printed because they were asked for; act on the bands and the trend, not on them.`;

  const buys = holdings.filter((h) => h.verdict === "BUY").map((h) => h.symbol);
  const waits = holdings.filter((h) => h.verdict === "WAIT").map((h) => h.symbol);
  const trims = holdings.filter((h) => h.verdict === "TRIM").map((h) => h.symbol);
  const idxLine = indices.map((i) => `${i.title} ${i.last.toLocaleString("en-PK", { maximumFractionDigits: 0 })} (${i.dayChangePct >= 0 ? "+" : ""}${i.dayChangePct.toFixed(2)}%)${i.trend ? ", " + i.trend.label.toLowerCase() : ""}`).join("\n");
  const summaryLines = [
    `<b>Charts for ${today}</b>`,
    idxLine,
    "",
    buys.length ? `<b>Add today:</b> ${buys.join(", ")} — at your price and not falling.` : "<b>Add today:</b> nothing. No held name is both at your price and out of its fall.",
    waits.length ? `<b>At your price but still falling:</b> ${waits.join(", ")}. Wait for a close back above the 50-day.` : "",
    trims.length ? `<b>In a sell band:</b> ${trims.join(", ")}.` : "",
    "",
    skillNote,
  ].filter((l) => l !== "");

  return { date: today, indices, holdings, summary: summaryLines.join("\n"), skillNote };
}
