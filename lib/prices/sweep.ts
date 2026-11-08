import "server-only";
import { connectDb } from "@/lib/db";
import { AnnouncementModel, BuyListModel, FeedSnapshotModel, HoldingModel, PriceSnapshotModel } from "@/lib/models";
import { dpsFetch, dpsResting, keepRelayedPages, takeWishes } from "@/lib/prices/dps";
import { REPORT_HOUR, isWeekday, lastTradingDay, nextGap, readLate, readLine, sweepItems, sweepLength, sweepStart } from "@/lib/calculations/sweep";
import { lastRead, qualityUniverse, readCompanies } from "@/lib/fundamentals/refresh";
import { marketHolidays } from "@/lib/market-calendar";
import { INDEX_SERIES } from "@/lib/quant/index-bars";
import { refreshCloses } from "@/lib/quant/daily";
import { refreshIndexForecasts } from "@/lib/index-week/data";

// The one daily read of the exchange's site (lib/calculations/sweep): a tick
// every few minutes reads at most one page, when its random time has come.
// The closing file and the index closes go first, so the day's prices are in
// within the hour; each company page then brings its announcements, dividends
// and results. A page the site refuses stays in the list and the gate rests;
// the next day's list takes over from whatever is left.

const KEY = "dps:sweep";
const DAILY_PAGES = 25;
const pkDay = (now: number) => new Date(now + 5 * 3600_000).toISOString().slice(0, 10);

type Sweep = { day: string; items: string[]; done: number; indexPages: number; startedAt?: string; nextAt: string; finishBy: string; read: number; missed: number; closes: boolean; finishedAt?: string };

// What is wanted of the site: the index pages, the shares held and on the
// buy list (their letters say a dividend before the ex-date), then the rest,
// read longest ago first, up to `max` in all.
export async function pagesWanted(max = DAILY_PAGES): Promise<{ indices: string[]; held: string[]; rest: string[] }> {
  await connectDb();
  const all = await qualityUniverse();
  const read = await lastRead(all);
  const held = [...new Set([...((await HoldingModel.find({ currentShares: { $gt: 0 } }, { symbol: 1 }).lean()) as any[]).map((h) => String(h.symbol)), ...((await BuyListModel.distinct("symbol", {})) as string[])])];
  const rest = all.filter((s) => !held.includes(s)).sort((a, b) => (read.get(a) ?? 0) - (read.get(b) ?? 0));
  return { indices: ["/indices", ...INDEX_SERIES.map((c) => `/indices/${c}`)], held, rest: rest.slice(0, Math.max(0, max - held.length)) };
}

async function save(s: Sweep, note: string): Promise<void> {
  await FeedSnapshotModel.updateOne({ key: KEY }, { $set: { key: KEY, data: s, status: "ok", note: note.slice(0, 160), updatedAt: new Date() } }, { upsert: true });
}

export async function sweepState(): Promise<Sweep | null> {
  await connectDb();
  const d: any = await FeedSnapshotModel.findOne({ key: KEY }).lean();
  return d?.data ?? null;
}

async function newSweep(day: string, now: number): Promise<Sweep> {
  const w = await pagesWanted();
  const items = sweepItems({ ...w, wished: await takeWishes() });
  const s: Sweep = { day, items, done: 0, indexPages: w.indices.length, startedAt: new Date(now).toISOString(), nextAt: new Date(now).toISOString(), finishBy: new Date(now + sweepLength()).toISOString(), read: 0, missed: 0, closes: false };
  await save(s, `${day}: ${items.length} pages to ${s.finishBy.slice(0, 16)}`);
  return s;
}

// One tick. Starts the day's sweep when its time has come, then reads the
// next page if it is due.
export async function sweepTick(now = Date.now()): Promise<Record<string, unknown>> {
  await connectDb();
  const today = pkDay(now);
  let s = await sweepState();
  if (s?.day !== today && isWeekday(today) && now >= sweepStart(today) && !(await marketHolidays()).has(today)) s = await newSweep(today, now);
  if (!s || s.done >= s.items.length) return { status: "nothing due", startsAt: new Date(sweepStart(today)).toISOString() };
  if (now < Date.parse(s.nextAt)) return { status: "waiting", day: s.day, done: s.done, of: s.items.length, nextAt: s.nextAt };
  const resting = await dpsResting();
  if (resting) return { status: "resting", until: resting.until };

  const path = s.items[s.done];
  let html: string | null = null;
  try {
    const res = await dpsFetch(path, { headers: { accept: "text/html" } }, { sweep: true, relay: false, timeoutMs: 30_000 });
    if (res.status === 403 || res.status === 429) return { status: "refused", path };
    if (res.ok) html = await res.text();
  } catch {
    return { status: "refused", path }; // the page stays next in line; the gate rests
  }
  if (html) await keepRelayedPages({ [path]: { html, fetchedAt: new Date(now).toISOString() } });
  s.done += 1;
  s.read += html ? 1 : 0;
  s.missed += html ? 0 : 1;
  const left = s.items.length - s.done;
  s.nextAt = new Date(now + nextGap(now, Date.parse(s.finishBy), left)).toISOString();
  if (left === 0) s.finishedAt = new Date(now).toISOString();
  await save(s, `${s.day}: ${s.done} of ${s.items.length}, next ${s.nextAt.slice(11, 16)} UTC`);

  const out: Record<string, unknown> = { status: "read", path, ok: !!html, done: s.done, of: s.items.length, nextAt: s.nextAt };
  // The index pages in: the day's closing file, the prices and index closes.
  if (s.done >= s.indexPages && !s.closes) {
    const closes = await refreshCloses().catch((e) => ({ error: String(e).slice(0, 200) }));
    await refreshIndexForecasts().catch(() => null);
    s.closes = !("error" in closes);
    await save(s, `${s.day}: closes ${s.closes ? "in" : "failed"}, ${s.done} of ${s.items.length}`);
    out.closes = s.closes;
  }
  if (html && path.startsWith("/company/")) out.company = await readCompanies([decodeURIComponent(path.slice("/company/".length))], { lite: true }).catch((e) => String(e).slice(0, 120));
  return out;
}

// For the alerts job, for one user: from 8 in the morning the line on the
// last trading day's read (lib/calculations/sweep readLine), and from 8 pm a
// warning when the night's read has not started. Each goes out once (the
// alert log keys them by day).
export async function readAlerts(userId: string, now = Date.now()): Promise<Array<{ key: string; message: string }>> {
  await connectDb();
  const pk = new Date(now + 5 * 3600_000);
  const today = pk.toISOString().slice(0, 10);
  const hour = pk.getUTCHours();
  const [holidays, s] = await Promise.all([marketHolidays(), sweepState()]);
  const out: Array<{ key: string; message: string }> = [];
  const day = lastTradingDay(today, holidays);
  // A read newer than the day reported means the report's morning has
  // passed with the app down; the next morning reports the newer one.
  if (hour >= REPORT_HOUR && !(s && s.day > day)) {
    const held = (await HoldingModel.distinct("symbol", { userId, currentShares: { $gt: 0 } })) as string[];
    const watched = [...new Set([...held, ...((await BuyListModel.distinct("symbol", { userId })) as string[])])];
    const [closes, last, news, resting] = await Promise.all([
      PriceSnapshotModel.distinct("symbol", { source: "dps-close", asOf: day, symbol: { $in: held } }) as Promise<string[]>,
      PriceSnapshotModel.findOne({ source: "dps-close", symbol: { $in: held } }, { asOf: 1 }).sort({ asOf: -1 }).lean() as Promise<any>,
      AnnouncementModel.distinct("symbol", { symbol: { $in: watched }, seenAt: { $gte: new Date(s?.day === day && s.startedAt ? s.startedAt : day + "T12:00:00Z") } }) as Promise<string[]>,
      dpsResting(),
    ]);
    const line = readLine({ day, read: s ? { day: s.day, items: s.items.length, done: s.done, read: s.read, missed: s.missed, finishedAt: s.finishedAt ?? null } : null, held: held.length, closes: closes.length, lastClose: last?.asOf ?? null, news: news.sort(), refusing: !!resting });
    out.push({ key: `read:${day}`, message: line.text });
  }
  const late = readLate({ today, hour, holidays, readDay: s?.day ?? null });
  if (late) out.push({ key: `read-late:${today}`, message: late });
  return out;
}

