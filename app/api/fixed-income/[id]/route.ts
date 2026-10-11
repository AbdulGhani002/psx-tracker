import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { FixedIncomeModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  face: z.number().positive().optional(),
  cost: z.number().positive().optional(),
  purchaseDate: date.optional(),
  maturityDate: date.optional(),
  couponPct: z.number().min(0).max(100).optional(),
  couponsPerYear: z.number().int().min(0).max(12).optional(),
  taxPct: z.number().min(0).max(100).optional(),
  pricePct: z.number().positive().max(300).nullable().optional(),
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const p = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await FixedIncomeModel.findOneAndUpdate({ _id: id, userId: await uid() }, { $set: p }, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await connectDb();
  const res = await FixedIncomeModel.deleteOne({ _id: id, userId: await uid() });
  return NextResponse.json({ ok: res.deletedCount === 1 });
}
