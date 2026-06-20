import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { WatchlistEntryModel } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  notes: z.string().default(""),
  targetBuyPrice: z.number().nullable().optional(),
  targetSellPrice: z.number().nullable().optional(),
});

export async function GET() {
  await connectDb();
  const docs = await WatchlistEntryModel.find({ userId: await uid() }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ entries: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = postSchema.parse(body);
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
    });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
