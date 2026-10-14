import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, PriceSnapshotModel } from "@/lib/models";
import { getSectorInfo } from "@/lib/sectors";
import { fetchPSXPage } from "@/lib/prices/scraper";
import { isMarketHoursNow } from "@/lib/prices/types";
import { listings } from "@/lib/listings";
import { latestCloses } from "@/lib/quant/sheet-bars";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Add a company you don't own yet but plan to buy, so the rebalance plan can
// size the purchase. Validates the symbol against PSX (so typos are caught):
// a live quote when the exchange serves one, else the exchange's own list of
// shares and the last closing price kept (the exchange refuses the server's
// address at times). Creates a 0-share holding with a target %, and seeds a
// live price snapshot when there is one, so the buy can be sized on the very
// next page load.
const schema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  targetAllocationPercent: z.number().min(0).max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { symbol, targetAllocationPercent } = schema.parse(await req.json());
    await connectDb();

    const exists = await HoldingModel.findOne({ userId: await uid(), symbol });

    // A holding you no longer own is DORMANT, not a duplicate. Sell out of a
    // position and the record stays behind with no shares and no target, which
    // the targets table hides as a ghost. Refusing to re-add it left those
    // symbols unreachable from every screen: invisible in the table, rejected
    // here. So a dormant record is adopted rather than rejected — the target
    // goes on, the price is refreshed, and it reappears in the plan.
    if (exists && (exists.currentShares ?? 0) > 0) {
      return NextResponse.json({ error: "exists", symbol }, { status: 409 });
    }

    const snap = await fetchPSXPage(symbol).catch(() => null);
    const listed = listings().find((l) => l.symbol === symbol);
    const close = snap?.price == null ? (await latestCloses().catch(() => new Map<string, { date: string; close: number }>())).get(symbol) : undefined;
    const price = snap?.price ?? close?.close ?? null;
    if (price == null && !listed) {
      return NextResponse.json(
        { error: "not_found", detail: `PSX does not list ${symbol}. Check the symbol.` },
        { status: 404 }
      );
    }

    const info = getSectorInfo(symbol);
    const created = exists
      ? await HoldingModel.findOneAndUpdate(
          { _id: exists._id },
          {
            $set: {
              targetAllocationPercent: targetAllocationPercent ?? exists.targetAllocationPercent ?? 0,
              // Refresh the name and sector while we are here; a dormant record
              // can be years old. Cost basis and history are left untouched.
              name: snap?.name || exists.name || listed?.name || info.name,
              sector: snap?.sector || exists.sector || listed?.sectorName || info.sector,
            },
          },
          { new: true }
        )
      : await HoldingModel.create({
          userId: await uid(),
          symbol,
          name: snap?.name || listed?.name || info.name,
          sector: snap?.sector || listed?.sectorName || info.sector,
          shariaCompliant: info.shariaCompliant,
          targetAllocationPercent: targetAllocationPercent ?? 0,
          notes: "",
        });

    if (snap?.price != null) {
      await PriceSnapshotModel.create({
        userId: await uid(),
        symbol,
        price,
        timestamp: new Date(),
        source: "psx-scraper",
        isMarketHours: isMarketHoursNow(new Date()),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        symbol,
        name: created?.name,
        sector: created?.sector,
        price,
        // Tells the page whether to say "added" or "brought back", because
        // silently reusing an old record would hide that history exists.
        adopted: !!exists,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
