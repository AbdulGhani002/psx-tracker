import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { WatchlistEntryModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  notes: z.string().optional(),
  targetBuyPrice: z.number().nullable().optional(),
  targetSellPrice: z.number().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { symbol: string } }) {
  try {
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    await connectDb();
    const doc = await WatchlistEntryModel.findOneAndUpdate(
      { symbol: params.symbol.toUpperCase() },
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

export async function DELETE(_req: NextRequest, { params }: { params: { symbol: string } }) {
  await connectDb();
  const doc = await WatchlistEntryModel.findOneAndDelete({ symbol: params.symbol.toUpperCase() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
