import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { WatchlistEntryModel } from "@/lib/models";
import { zoneWarningsFrom } from "@/lib/calculations/zones";

export const dynamic = "force-dynamic";

const price = z.number().positive().nullable().optional();

const patchSchema = z.object({
  notes: z.string().optional(),
  targetBuyPrice: price,
  targetSellPrice: price,
  buyZoneLow: price,
  buyZoneHigh: price,
  sellZoneLow: price,
  sellZoneHigh: price,
  minHoldingShares: z.number().min(0).optional(),
  alertsOn: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ symbol: string }> }) {
  const params = await props.params;
  try {
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    const symbol = params.symbol.toUpperCase();
    await connectDb();
    const current = await WatchlistEntryModel.findOne({ userId: await uid(), symbol }).lean();
    if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Validate the row as it WOULD be after the patch, not the patch alone —
    // raising one bound can contradict a bound that is already stored.
    const problems = zoneWarningsFrom(symbol, { ...current, ...parsed });
    if (problems.length > 0) {
      return NextResponse.json({ error: "zone_conflict", problems }, { status: 400 });
    }
    const doc = await WatchlistEntryModel.findOneAndUpdate(
      { userId: await uid(), symbol },
      parsed,
      { new: true }
    ).lean();
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ symbol: string }> }) {
  const params = await props.params;
  await connectDb();
  const doc = await WatchlistEntryModel.findOneAndDelete({ userId: await uid(), symbol: params.symbol.toUpperCase() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
