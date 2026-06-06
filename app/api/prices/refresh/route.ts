import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAllHoldings } from "@/lib/data";
import { refreshPrice } from "@/lib/prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Module-level in-flight guard so two concurrent refreshes don't pile up.
let refreshing = false;

// Force a fresh scrape for all held symbols. We DO NOT delete the cache first —
// refreshPrice writes a new snapshot and reads always take the newest by
// timestamp, so there is never a window with no price. Failed symbols simply
// keep their previous snapshot.
export async function POST() {
  if (refreshing) {
    return NextResponse.json({ skipped: true, reason: "already_refreshing" });
  }
  refreshing = true;
  try {
    await connectDb();
    const holdings = await getAllHoldings();
    const symbols = holdings.filter((h) => (h.currentShares ?? 0) > 0).map((h) => h.symbol);
    let refreshed = 0;
    const failed: string[] = [];
    for (const s of symbols) {
      try {
        const q = await refreshPrice(s);
        if (q) refreshed++;
        else failed.push(s);
      } catch {
        failed.push(s);
      }
    }
    return NextResponse.json({ refreshed, total: symbols.length, failed });
  } finally {
    refreshing = false;
  }
}
