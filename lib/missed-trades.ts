import "server-only";
import { connectDb } from "@/lib/db";
import { BuyListModel, FeedSnapshotModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { SHEET_PREFIX } from "@/lib/quant/sheet-bars";
import { missedMessage, missedReview, type MissedItem } from "@/lib/calculations/missed-trades";
import type { DayRow } from "@/lib/timeseries/psx-history";

// The buy list over a month (yyyy-mm), from the closing files kept: each
// share's lowest low and its first and last closes, from the day it was
// listed.
export async function missedReviewForCurrentUser(month: string): Promise<string | null> {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const list = (await BuyListModel.find({ userId }, { symbol: 1, tiers: 1, createdAt: 1 }).lean()) as any[];
  if (list.length === 0) return null;
  const docs = (await FeedSnapshotModel.find({ key: { $gte: `${SHEET_PREFIX}${month}-01`, $lte: `${SHEET_PREFIX}${month}-31` } }, { key: 1, "data.rows": 1 }).sort({ key: 1 }).lean()) as any[];
  if (docs.length === 0) return null;
  const items: MissedItem[] = list.map((b) => {
    const since = b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : "";
    const top = Math.max(0, ...((b.tiers ?? []) as any[]).map((t) => Number(t.high) || 0));
    let minLow: number | null = null, first: number | null = null, last: number | null = null;
    for (const d of docs) {
      const date = String(d.key).slice(SHEET_PREFIX.length);
      if (date < since) continue;
      const r = ((d.data?.rows ?? []) as DayRow[]).find((x) => x[0] === b.symbol);
      if (!r) continue;
      if (r[3] > 0) minLow = minLow == null ? r[3] : Math.min(minLow, r[3]);
      if (r[4] > 0) {
        if (first == null) first = r[4];
        last = r[4];
      }
    }
    return { symbol: String(b.symbol), top, minLow, first, last };
  });
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return missedMessage(label, missedReview(items));
}
