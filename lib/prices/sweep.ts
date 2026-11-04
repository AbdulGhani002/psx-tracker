import "server-only";
import { connectDb } from "@/lib/db";
import { BuyListModel, FeedSnapshotModel, HoldingModel } from "@/lib/models";
import { dpsFetch, dpsResting, keepRelayedPages, takeWishes } from "@/lib/prices/dps";
import { isWeekday, nextGap, sweepItems, sweepLength, sweepStart } from "@/lib/calculations/sweep";
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

type Sweep = { day: string; items: string[]; done: number; indexPages: number; nextAt: string; finishBy: string; read: number; missed: number; closes: boolean; finishedAt?: string };

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
  const s: Sweep = { day, items, done: 0, indexPages: w.indices.length, nextAt: new Date(now).toISOString(), finishBy: new Date(now + sweepLength()).toISOString(), read: 0, missed: 0, closes: false };
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
