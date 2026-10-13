import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, IndexForecastModel } from "@/lib/models";
import { loadStoredBars } from "@/lib/quant/sheet-bars";
import { levelsNow, walkForward, summarise, hitsOf, outcomeAfter, isoWeek, type Close, type Levels } from "./forecast";
import type { IndexView, IndexForecasts } from "./message";
import type { RecordSummary } from "./forecast";

export type { IndexView, IndexForecasts } from "./message";
export { weekMessage, weekMessageDue } from "./message";

// The indexes' levels for the week and the month ahead (forecast.ts), worked
// out again after every close the server keeps and kept as one snapshot for
// the Model page, the strategy's first zone and the Friday message. Every
// close's levels are also stored as published (lib/models/IndexForecast) with
// what followed, so the live record builds up beside the tested one.

export const INDEXES = [
  { code: "KSE100", label: "KSE-100" },
  { code: "KMI30", label: "KMI-30" },
  { code: "KSE30", label: "KSE-30" },
] as const;

const KEY = "index:forecast:v1";

async function closesOf(codes: string[]): Promise<Map<string, Close[]>> {
  const bars = await loadStoredBars(codes);
  return new Map(codes.map((c) => [c, (bars.get(c) ?? []).filter((b) => b.close > 0).map((b) => ({ date: b.date, close: b.close }))]));
}

// Stores today's levels, and what followed for those whose sessions are done.
async function keepPublished(code: string, closes: Close[], levels: Array<Levels | null>): Promise<RecordSummary> {
  for (const l of levels) {
    if (!l) continue;
    await IndexForecastModel.updateOne(
      { code, sessions: l.sessions, asOf: l.asOf },
      { $setOnInsert: { code, sessions: l.sessions, asOf: l.asOf, close: l.close, sigmaPct: l.sigmaPct, range: l.range, mid: l.mid, buy: l.buy, sell: l.sell } },
      { upsert: true }
    );
  }
  const at = new Map(closes.map((c, k) => [c.date, k]));
  const open = (await IndexForecastModel.find({ code, outcome: null }).lean()) as any[];
  for (const d of open) {
    const T = at.get(d.asOf);
    const o = T != null ? outcomeAfter(closes, T, d.sessions) : null;
    if (!o) continue;
    const l = { asOf: d.asOf, close: d.close, sessions: d.sessions, sigmaPct: d.sigmaPct, range: d.range, mid: d.mid, buy: d.buy, sell: d.sell } as Levels;
    await IndexForecastModel.updateOne({ _id: d._id }, { $set: { outcome: o, hits: hitsOf(l, o) } });
  }
  // The live weekly record: levels set on a week's last session.
  const lastOfWeek = new Set(closes.filter((c, k) => k + 1 < closes.length && isoWeek(c.date) !== isoWeek(closes[k + 1].date)).map((c) => c.date));
  const done = ((await IndexForecastModel.find({ code, sessions: 5, outcome: { $ne: null } }).sort({ asOf: 1 }).lean()) as any[]).filter((d) => lastOfWeek.has(d.asOf));
  return summarise(done.map((d) => ({ levels: { asOf: d.asOf } as Levels, outcome: d.outcome, hits: d.hits })));
}

export async function refreshIndexForecasts(): Promise<IndexForecasts> {
  await connectDb();
  const all = await closesOf(INDEXES.map((i) => i.code));
  const indexes: IndexView[] = [];
  for (const { code, label } of INDEXES) {
    const closes = all.get(code) ?? [];
    if (closes.length < 260) continue;
    const last = closes[closes.length - 1];
    const weekRows = walkForward(closes, 5);
    const monthRows = walkForward(closes, 20);
    const week = levelsNow(closes, 5);
    const month = levelsNow(closes, 20);
    const prevWeekEnd = [...closes].reverse().find((c) => isoWeek(c.date) !== isoWeek(last.date));
    const live = await keepPublished(code, closes, [week, month]).catch(() => summarise([]));
    indexes.push({
      code,
      label,
      date: last.date,
      close: last.close,
      weekChangePct: prevWeekEnd ? Math.round((last.close / prevWeekEnd.close - 1) * 1000) / 10 : null,
      week,
      month,
      tested: { week: summarise(weekRows), weekLastYear: summarise(weekRows.slice(-52)), month: summarise(monthRows) },
      live,
      weeks: weekRows.slice(-10).reverse(),
    });
  }
  const out: IndexForecasts = { asOf: indexes[0]?.date ?? null, computedAt: new Date().toISOString(), indexes };
  await FeedSnapshotModel.findOneAndUpdate({ key: KEY }, { key: KEY, data: out, status: "ok", note: `${indexes.length} indexes to ${out.asOf}`, updatedAt: new Date() }, { upsert: true });
  return out;
}

// The kept snapshot, worked out again when a newer close has come in.
export async function getIndexForecasts(): Promise<IndexForecasts | null> {
  await connectDb();
  const d: any = await FeedSnapshotModel.findOne({ key: KEY }, { data: 1 }).lean();
  const kept = (d?.data ?? null) as IndexForecasts | null;
  const head: any = await FeedSnapshotModel.findOne({ key: "eod:bars:KSE100" }, { "data.bars": { $slice: -1 } }).lean();
  const latest = head?.data?.bars?.[0]?.date ?? null;
  if (kept && (!latest || kept.asOf === latest)) return kept;
  return refreshIndexForecasts().catch(() => kept);
}
