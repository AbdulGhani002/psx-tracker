import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, FundamentalModel } from "@/lib/models";
import { marketEvents } from "@/lib/market-calendar";
import { getInflationLive, getPortfolioSummary, getSbpRateSteps, getTbill12mPct } from "@/lib/data";
import { getEarningsCalendar } from "@/lib/analytics";
import { SHEET_PREFIX, loadStoredBars } from "@/lib/quant/sheet-bars";
import { mongoBarsCache } from "@/lib/quant/store";
import { MACRO_SERIES, fetchUsdPkrDaily, fetchYahooDaily } from "@/lib/timeseries/macro";
import { policyRateOn } from "@/lib/timeseries/sbp-rate";
import { exDateOf } from "@/lib/calculations/exdate";
import { dailyBrief, normalDayPct, timesNormal, type BriefInput } from "@/lib/calculations/daily-brief";
import { getMarketStudies } from "@/lib/market-history";
import type { DayRow } from "@/lib/timeseries/psx-history";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import listed from "@/lib/psx-symbols.json";

// The evening brief for the current user (lib/calculations/daily-brief):
// today's closing file (breadth, value traded, each share's day), the
// KSE-100 against its normal day, the shares held, the rates, the world, and
// the dated events of the coming week (MarketEvent, ex-dates, board
// meetings). None until today's closing file is kept.

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// The listed shares (rights left out): the closing file also carries
// government debt, traded in billions of rupees of face value.
const SHARES = new Set((listed as Array<{ symbol: string; name: string }>).filter((x) => !/\(right/i.test(x.name)).map((x) => x.symbol));

// Oil, gold, the S&P 500 and the rupee: each one's last day against the one
// before and its own normal day. Kept a day in the bars cache.
async function worldLine(today: string): Promise<BriefInput["world"]> {
  const cache = mongoBarsCache(20);
  const want: Array<{ key: string; label: string; level?: (v: number) => string }> = [
    { key: "spx", label: "S&P 500" },
    { key: "oil", label: "oil", level: (v) => `$${v.toFixed(0)}` },
    { key: "gold", label: "gold", level: (v) => `$${Math.round(v).toLocaleString("en-US")}` },
    { key: "usdpkr", label: "Rs/$", level: (v) => v.toFixed(2) },
  ];
  const out: BriefInput["world"] = [];
  for (const w of want) {
    const s = MACRO_SERIES.find((m) => m.key === w.key);
    if (!s) continue;
    let bars = (await cache.get(`MACRO:${s.key}`).catch(() => null)) as EodBar[] | null;
    if (!bars || bars.length === 0) {
      bars = await (s.key === "usdpkr" ? fetchUsdPkrDaily() : fetchYahooDaily(s.symbol)).catch(() => [] as EodBar[]);
      if (bars.length > 0) await cache.put(`MACRO:${s.key}`, bars).catch(() => {});
    }
    const closes = (bars ?? []).filter((b) => b.close > 0);
    if (closes.length < 2 || closes[closes.length - 1].date < addDays(today, -4)) continue;
    const last = closes[closes.length - 1].close, prev = closes[closes.length - 2].close;
    const change = (last / prev - 1) * 100;
    out.push({ label: w.label, changePct: change, times: timesNormal(change, normalDayPct(closes.map((b) => b.close))), level: w.level?.(last) });
  }
  return out;
}

export async function dailyBriefForCurrentUser(today: string): Promise<string | null> {
  await connectDb();
  const sheet: any = await FeedSnapshotModel.findOne({ key: SHEET_PREFIX + today }, { "data.rows": 1 }).lean();
  const rows = (sheet?.data?.rows ?? []) as DayRow[];
  if (rows.length < 50) return null;
  const bySym = new Map(rows.map((r) => [r[0], r]));

  let up = 0, down = 0, same = 0, valueRs = 0;
  for (const r of rows) {
    const close = r[4], ldcp = r[6];
    if (!(close > 0) || !SHARES.has(r[0])) continue;
    valueRs += close * (r[5] || 0);
    if (ldcp > 0) {
      if (close > ldcp) up++;
      else if (close < ldcp) down++;
      else same++;
    }
  }

  const idx: any = await FeedSnapshotModel.findOne({ key: "eod:bars:KSE100" }, { "data.bars": { $slice: -800 } }).lean();
  const bars = ((idx?.data?.bars ?? []) as EodBar[]).filter((b) => b.close > 0);
  const last = bars[bars.length - 1], prev = bars[bars.length - 2];
  const kse = last && prev && last.date === today ? { close: last.close, changePct: (last.close / prev.close - 1) * 100, normalPct: normalDayPct(bars.map((b) => b.close)) } : null;

  const summary = await getPortfolioSummary();
  const held = [...summary.positions, ...summary.parked].filter((p) => p.shares > 0);
  let value = 0, before = 0;
  for (const p of held) {
    const r = bySym.get(p.symbol);
    if (r && r[4] > 0 && r[6] > 0) {
      value += p.shares * r[4];
      before += p.shares * r[6];
    }
  }
  const book = before > 0 ? { value, changeRs: value - before, changePct: (value / before - 1) * 100 } : null;
  const stored = await loadStoredBars(held.map((p) => p.symbol)).catch(() => new Map<string, EodBar[]>());
  const movers: BriefInput["movers"] = [];
  for (const p of held) {
    const r = bySym.get(p.symbol);
    if (!r || !(r[4] > 0) || !(r[6] > 0)) continue;
    const change = (r[4] / r[6] - 1) * 100;
    const t = timesNormal(change, normalDayPct((stored.get(p.symbol) ?? []).map((b) => b.close)));
    if (t != null && Math.abs(change) >= 1.5) movers.push({ symbol: p.symbol, changePct: change, times: t });
  }

  const [steps, tbill, cpi] = await Promise.all([getSbpRateSteps().catch(() => null), getTbill12mPct().catch(() => null), getInflationLive().catch(() => null)]);
  const rates = { policy: steps?.steps.length ? policyRateOn(today, steps.steps) : null, tbill, cpi: cpi?.yoyPct ?? null };

  const weekOn = addDays(today, 7);
  const next: BriefInput["next"] = (await marketEvents(today, weekOn).catch(() => [])).map((e) => ({ date: e.date, title: e.title }));
  const heldSyms = new Set(held.map((p) => p.symbol));
  for (const f of (await FundamentalModel.find({ symbol: { $in: [...heldSyms] } }, { symbol: 1, payouts: 1 }).lean()) as any[]) {
    for (const p of f.payouts ?? []) {
      if (p.payoutType !== "cash" || !p.bookClosure || p.bookClosure < today) continue;
      const ex = exDateOf(p.bookClosure).exDate;
      if (ex >= today && ex <= weekOn) next.push({ date: ex, title: `${f.symbol} goes ex-dividend` });
    }
  }
  const cal = await getEarningsCalendar().catch(() => null);
  for (const e of cal?.upcoming ?? []) if (heldSyms.has(e.symbol) && e.date >= today && e.date <= weekOn) next.push({ date: e.date, title: `${e.symbol} board meeting` });

  const world = await worldLine(today).catch(() => []);

  // The month's first trading day: the closing file before today's is from
  // an earlier month.
  const prevFile: any = await FeedSnapshotModel.findOne({ key: { $lt: SHEET_PREFIX + today, $gte: SHEET_PREFIX + "2000" } }, { key: 1 }).sort({ key: -1 }).lean();
  let month: BriefInput["month"] = null;
  if (!prevFile || String(prevFile.key).slice(SHEET_PREFIX.length, SHEET_PREFIX.length + 7) < today.slice(0, 7)) {
    const st = await getMarketStudies().catch(() => null);
    const m = st?.patterns.months.find((x) => x.m === Number(today.slice(5, 7)));
    if (m) month = { label: m.label, up: m.up, n: m.n, median: m.median };
  }
  return dailyBrief({ date: today, kse, breadth: { up, down, same, valueRs }, book, movers, rates, world, next, month });
}
