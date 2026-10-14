import "server-only";
import { connectDb } from "@/lib/db";
import { SellListModel, FeedSnapshotModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { listings } from "@/lib/listings";
import { latestCloses, SHEET_PREFIX, pktToday } from "@/lib/quant/sheet-bars";
import type { DayRow } from "@/lib/timeseries/psx-history";
import { advance, reachMessage, toGoPct, type Level, type Day } from "./levels";

// The sell list (app/sell-list): each share with its last close and how far
// each level is; after every closing file kept the levels are moved on
// (levels.ts), and a level reached in the last week is a Telegram alert
// until it has gone out (the alerts job dedupes it).

export type SellListItem = {
  id: string;
  symbol: string;
  name: string;
  note: string;
  price: number | null;
  priceDate: string | null;
  levels: Array<Level & { toGo: number | null }>;
};

export async function getSellList(): Promise<{ items: SellListItem[]; asOf: string | null }> {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const [docs, closes] = await Promise.all([SellListModel.find({ userId }).lean() as Promise<any[]>, latestCloses().catch(() => new Map<string, { date: string; close: number }>())]);
  const names = new Map(listings().map((l) => [l.symbol, l.name]));
  const items: SellListItem[] = docs.map((d) => {
    const c = closes.get(d.symbol) ?? null;
    return { id: String(d._id), symbol: d.symbol, name: names.get(d.symbol) ?? d.symbol, note: d.note ?? "", price: c?.close ?? null, priceDate: c?.date ?? null, levels: ((d.levels ?? []) as Level[]).map((l) => ({ ...l, toGo: toGoPct(c?.close ?? null, l) })) };
  });
  // The share nearest a level not yet reached first.
  const gap = (i: SellListItem) => Math.min(1000, ...i.levels.filter((l) => !l.reachedAt && l.toGo != null).map((l) => Math.abs(l.toGo!)));
  items.sort((a, b) => gap(a) - gap(b) || a.symbol.localeCompare(b.symbol));
  const asOf = [...closes.values()].reduce<string | null>((m, c) => (m == null || c.date > m ? c.date : m), null);
  return { items, asOf };
}

async function sheetsFrom(from: string): Promise<Array<{ date: string; rows: Map<string, DayRow> }>> {
  const docs = (await FeedSnapshotModel.find({ key: { $gte: SHEET_PREFIX + from, $lt: SHEET_PREFIX + "~" }, status: { $ne: "holiday" } }, { key: 1, data: 1 }).sort({ key: 1 }).lean()) as any[];
  return docs
    .map((d) => ({ date: String(d.data?.date ?? String(d.key).slice(SHEET_PREFIX.length)), rows: new Map(((d.data?.rows ?? []) as DayRow[]).map((r) => [r[0], r])) }))
    .filter((s) => s.rows.size > 0);
}

// Moves one user's levels on through every closing file not yet applied.
export async function advanceSellList(userId: string): Promise<number> {
  await connectDb();
  const docs = (await SellListModel.find({ userId }).lean()) as any[];
  if (docs.length === 0) return 0;
  const starts = docs.map((d) => d.checkedThrough || ((d.levels ?? []) as Level[]).map((l) => l.armedAt).filter(Boolean).sort()[0] || pktToday());
  const sheets = await sheetsFrom(starts.sort()[0]);
  if (sheets.length === 0) return 0;
  let reached = 0;
  for (const d of docs) {
    const days: Day[] = [];
    for (const s of sheets) {
      if (d.checkedThrough && s.date <= d.checkedThrough) continue;
      const row = s.rows.get(d.symbol);
      if (row) days.push({ date: s.date, high: row[2], close: row[4] });
    }
    const last = sheets[sheets.length - 1].date;
    if (days.length === 0 && d.checkedThrough === last) continue;
    const r = advance((d.levels ?? []) as Level[], days);
    reached += r.reached.length;
    // Only onto the version read: an edit made meanwhile wins.
    await SellListModel.updateOne({ _id: d._id, updatedAt: d.updatedAt }, { $set: { levels: r.levels, checkedThrough: last } });
  }
  return reached;
}

// The Telegram alerts: every level reached in the last week, one message each.
export async function sellListAlerts(userId: string, held: Map<string, { shares: number; avgCost: number }>): Promise<Array<{ key: string; message: string }>> {
  await advanceSellList(userId);
  const since = new Date(Date.parse(pktToday() + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const docs = (await SellListModel.find({ userId }).lean()) as any[];
  const out: Array<{ key: string; message: string }> = [];
  for (const d of docs) {
    for (const l of (d.levels ?? []) as Level[]) {
      if (!l.reachedAt || l.reachedAt < since || l.reachedPrice == null || l.reachedClose == null) continue;
      out.push({ key: `sell-zone:${String(d._id)}:${l.kind}:${l.price}:${l.reachedAt}`, message: reachMessage(d.symbol, l, { date: l.reachedAt, price: l.reachedPrice, close: l.reachedClose }, held.get(d.symbol) ?? null) });
    }
  }
  return out;
}
