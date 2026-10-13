import "server-only";
import { connectDb } from "@/lib/db";
import { BuyListModel, FeedSnapshotModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { listings } from "@/lib/listings";
import { latestCloses, SHEET_PREFIX, pktToday } from "@/lib/quant/sheet-bars";
import type { DayRow } from "@/lib/timeseries/psx-history";
import { advance, awayPct, reachMessage, type Tier, type Day } from "./zones";

// The buy list (app/buy-list): each share with its last close and how far each
// tier is; after every closing file kept (the server's own or the one the
// home machine hands over in the evening) the tiers are moved on
// (zones.ts), and a tier reached in the last week is a Telegram alert until
// it has gone out (the alerts job dedupes it).

export type BuyListItem = {
  id: string;
  symbol: string;
  name: string;
  note: string;
  price: number | null;
  priceDate: string | null;
  tiers: Array<Tier & { away: number | null }>;
  next: number | null; // the first tier not yet reached
};

const nameOf = () => new Map(listings().map((l) => [l.symbol, l.name]));

export async function getBuyList(): Promise<{ items: BuyListItem[]; asOf: string | null }> {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const [docs, closes] = await Promise.all([BuyListModel.find({ userId }).lean() as Promise<any[]>, latestCloses().catch(() => new Map<string, { date: string; close: number }>())]);
  const names = nameOf();
  const items: BuyListItem[] = docs.map((d) => {
    const c = closes.get(d.symbol) ?? null;
    const tiers = ((d.tiers ?? []) as Tier[]).map((t) => ({ ...t, away: awayPct(c?.close ?? null, t) }));
    const next = tiers.findIndex((t) => !t.reachedAt);
    return { id: String(d._id), symbol: d.symbol, name: names.get(d.symbol) ?? d.symbol, note: d.note ?? "", price: c?.close ?? null, priceDate: c?.date ?? null, tiers, next: next >= 0 ? next : null };
  });
  // The share nearest its next tier first; those with every tier reached last.
  const gap = (i: BuyListItem) => (i.next != null ? i.tiers[i.next].away ?? 999 : 1000);
  items.sort((a, b) => gap(a) - gap(b) || a.symbol.localeCompare(b.symbol));
  const asOf = [...closes.values()].reduce<string | null>((m, c) => (m == null || c.date > m ? c.date : m), null);
  return { items, asOf };
}

// The closing files kept from a date on, oldest first.
async function sheetsFrom(from: string): Promise<Array<{ date: string; rows: Map<string, DayRow> }>> {
  const docs = (await FeedSnapshotModel.find({ key: { $gte: SHEET_PREFIX + from, $lt: SHEET_PREFIX + "~" }, status: { $ne: "holiday" } }, { key: 1, data: 1 }).sort({ key: 1 }).lean()) as any[];
  return docs
    .map((d) => ({ date: String(d.data?.date ?? String(d.key).slice(SHEET_PREFIX.length)), rows: new Map(((d.data?.rows ?? []) as DayRow[]).map((r) => [r[0], r])) }))
    .filter((s) => s.rows.size > 0);
}

// Moves one user's tiers on through every closing file not yet applied.
// Returns how many tiers were reached.
export async function advanceBuyList(userId: string): Promise<number> {
  await connectDb();
  const docs = (await BuyListModel.find({ userId }).lean()) as any[];
  if (docs.length === 0) return 0;
  const starts = docs.map((d) => d.checkedThrough || ((d.tiers ?? []) as Tier[]).map((t) => t.armedAt).filter(Boolean).sort()[0] || pktToday());
  const sheets = await sheetsFrom(starts.sort()[0]);
  if (sheets.length === 0) return 0;
  let reached = 0;
  for (const d of docs) {
    const days: Day[] = [];
    for (const s of sheets) {
      if (d.checkedThrough && s.date <= d.checkedThrough) continue;
      const row = s.rows.get(d.symbol);
      if (row) days.push({ date: s.date, low: row[3], close: row[4] });
    }
    const last = sheets[sheets.length - 1].date;
    if (days.length === 0 && d.checkedThrough === last) continue;
    const r = advance((d.tiers ?? []) as Tier[], days);
    reached += r.reached.length;
    // Only onto the version read: an edit made meanwhile wins, and is moved
    // on at the next run.
    await BuyListModel.updateOne({ _id: d._id, updatedAt: d.updatedAt }, { $set: { tiers: r.tiers, checkedThrough: last } });
  }
  return reached;
}

// The Telegram alerts: every tier reached in the last week, one message each.
export async function buyListAlerts(userId: string): Promise<Array<{ key: string; message: string }>> {
  await advanceBuyList(userId);
  const since = new Date(Date.parse(pktToday() + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const docs = (await BuyListModel.find({ userId }).lean()) as any[];
  const out: Array<{ key: string; message: string }> = [];
  for (const d of docs) {
    const tiers = (d.tiers ?? []) as Tier[];
    tiers.forEach((t, k) => {
      if (!t.reachedAt || t.reachedAt < since || t.reachedLow == null || t.reachedClose == null) return;
      out.push({ key: `buy-zone:${String(d._id)}:${k}:${t.high}:${t.reachedAt}`, message: reachMessage(d.symbol, tiers, k, { date: t.reachedAt, low: t.reachedLow, close: t.reachedClose }) });
    });
  }
  return out;
}
