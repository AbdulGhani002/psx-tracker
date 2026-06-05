import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { CommodityTradeModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  currentPrice: z.number().nullable().optional(),
  exitPrice: z.number().positive().optional(),
  exitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  close: z.boolean().optional(), // close the trade with exitPrice/exitDate
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await CommodityTradeModel.findById(params.id);
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (parsed.currentPrice !== undefined) doc.currentPrice = parsed.currentPrice;
    if (parsed.notes !== undefined) doc.notes = parsed.notes;
    if (parsed.close && parsed.exitPrice) {
      doc.exitPrice = parsed.exitPrice;
      doc.exitDate = parsed.exitDate ?? new Date().toISOString().slice(0, 10);
      doc.status = "CLOSED";
    }
    await doc.save();
    return NextResponse.json(doc.toObject());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const doc = await CommodityTradeModel.findByIdAndDelete(params.id).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
