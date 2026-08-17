import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { WatchlistEntryModel } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";
import { zoneWarningsFrom } from "@/lib/calculations/zones";

export const dynamic = "force-dynamic";

const price = z.number().positive().nullable().optional();

const zoneFields = {
  notes: z.string().default(""),
  targetBuyPrice: price,
  targetSellPrice: price,
  buyZoneLow: price,
  buyZoneHigh: price,
  sellZoneLow: price,
  sellZoneHigh: price,
  minHoldingShares: z.number().min(0).optional(),
  alertsOn: z.boolean().optional(),
};

const postSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  ...zoneFields,
});

// Contradictory bands must never reach the database: a row that says both buy
// and sell at the same price would make the alert engine pick a side, and it
// has no business picking one. Rejected at the edge with the reason.

export async function GET() {
  await connectDb();
  const docs = await WatchlistEntryModel.find({ userId: await uid() }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ entries: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = postSchema.parse(body);
    const problems = zoneWarningsFrom(parsed.symbol, parsed);
    if (problems.length > 0) {
      return NextResponse.json({ error: "zone_conflict", problems }, { status: 400 });
    }
    await connectDb();

    const exists = await WatchlistEntryModel.findOne({ userId: await uid(), symbol: parsed.symbol });
    if (exists) {
      return NextResponse.json({ error: "exists", symbol: parsed.symbol }, { status: 409 });
    }

    // Fetch company info from PSX so we can show the name + sector immediately.
    const info = await getCompanyInfo(parsed.symbol);

    const created = await WatchlistEntryModel.create({
      userId: await uid(),
      symbol: parsed.symbol,
      name: info?.name ?? parsed.symbol,
      sector: info?.sector ?? "Unknown",
      notes: parsed.notes,
      targetBuyPrice: parsed.targetBuyPrice ?? null,
      targetSellPrice: parsed.targetSellPrice ?? null,
      buyZoneLow: parsed.buyZoneLow ?? null,
      buyZoneHigh: parsed.buyZoneHigh ?? null,
      sellZoneLow: parsed.sellZoneLow ?? null,
      sellZoneHigh: parsed.sellZoneHigh ?? null,
      minHoldingShares: parsed.minHoldingShares ?? 0,
      alertsOn: parsed.alertsOn ?? true,
    });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
