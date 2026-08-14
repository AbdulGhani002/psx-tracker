import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { CommodityTradeModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  name: z.string().default(""),
  side: z.enum(["LONG", "SHORT"]),
  lots: z.number().positive(),
  lotSize: z.number().positive(),
  entryPrice: z.number().positive(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currentPrice: z.number().nullable().optional(),
  notes: z.string().default(""),
  // Futures mechanics. All optional: an older trade may predate them, and a
  // missing expiry is reported as "not recorded" rather than invented.
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contractType: z.enum(["CASH_SETTLED", "DELIVERABLE"]).optional(),
  marginPosted: z.number().min(0).optional(),
  rolledFromId: z.string().nullable().optional(),
});

export async function GET() {
  await connectDb();
  const docs = await CommodityTradeModel.find({ userId: await uid() }).sort({ entryDate: -1 }).lean();
  return NextResponse.json({ trades: docs });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = postSchema.parse(await req.json());
    await connectDb();
    const created = await CommodityTradeModel.create({ userId: await uid(), ...parsed, status: "OPEN" });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
