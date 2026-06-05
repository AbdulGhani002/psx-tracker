import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { PriceSnapshotModel } from "@/lib/models";
import { getAllHoldings } from "@/lib/data";
import { refreshPrice } from "@/lib/prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Force a fresh scrape for all held symbols, bypassing the 15-min cache.
export async function POST() {
  await connectDb();
  const holdings = await getAllHoldings();
  const symbols = holdings.filter((h) => (h.currentShares ?? 0) > 0).map((h) => h.symbol);
  // Drop cached snapshots so the next read is fresh too.
  await PriceSnapshotModel.deleteMany({ symbol: { $in: symbols } });
  let refreshed = 0;
  for (const s of symbols) {
    const q = await refreshPrice(s);
    if (q) refreshed++;
  }
  return NextResponse.json({ refreshed, total: symbols.length });
}
