import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
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
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contractType: z.enum(["CASH_SETTLED", "DELIVERABLE"]).optional(),
  marginPosted: z.number().min(0).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await CommodityTradeModel.findOne({ _id: params.id, userId: await uid() });
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (parsed.currentPrice !== undefined) doc.currentPrice = parsed.currentPrice;
    if (parsed.expiryDate !== undefined) doc.expiryDate = parsed.expiryDate;
    if (parsed.contractType !== undefined) doc.contractType = parsed.contractType;
    if (parsed.marginPosted !== undefined) doc.marginPosted = parsed.marginPosted;
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
  const doc = await CommodityTradeModel.findOneAndDelete({ _id: params.id, userId: await uid() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
