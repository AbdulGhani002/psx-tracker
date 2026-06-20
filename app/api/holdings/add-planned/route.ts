import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, PriceSnapshotModel } from "@/lib/models";
import { getSectorInfo } from "@/lib/sectors";
import { fetchPSXPage } from "@/lib/prices/scraper";
import { isMarketHoursNow } from "@/lib/prices/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Add a company you don't own yet but plan to buy, so the rebalance plan can
// size the purchase. Validates the symbol against PSX (so typos are caught),
// creates a 0-share holding with a target %, and seeds a live price snapshot
// so the buy can be sized on the very next page load.
const schema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  targetAllocationPercent: z.number().min(0).max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { symbol, targetAllocationPercent } = schema.parse(await req.json());
    await connectDb();

    const exists = await HoldingModel.findOne({ userId: await uid(), symbol });
    if (exists) return NextResponse.json({ error: "exists", symbol }, { status: 409 });

    const snap = await fetchPSXPage(symbol);
    if (!snap || snap.price == null) {
      return NextResponse.json(
        { error: "not_found", detail: `PSX has no live quote for ${symbol}. Check the symbol.` },
        { status: 404 }
      );
    }

    const info = getSectorInfo(symbol);
    const created = await HoldingModel.create({
      userId: await uid(),
      symbol,
      name: snap.name || info.name,
      sector: snap.sector || info.sector,
      shariaCompliant: info.shariaCompliant,
      targetAllocationPercent: targetAllocationPercent ?? 0,
      notes: "",
    });

    await PriceSnapshotModel.create({
      userId: await uid(),
      symbol,
      price: snap.price,
      timestamp: new Date(),
      source: "psx-scraper",
      isMarketHours: isMarketHoursNow(new Date()),
    });

    return NextResponse.json(
      { ok: true, symbol, name: created.name, sector: created.sector, price: snap.price },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
