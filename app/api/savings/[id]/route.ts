import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { SavingsAccountModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().optional(),
  bank: z.string().optional(),
  ratePercent: z.number().min(0).max(100).optional(),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  anchorBalance: z.number().min(0).optional(),
  notes: z.string().optional(),
  // add a movement
  addMovement: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
      amount: z.number().positive(),
      note: z.string().default(""),
    })
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await SavingsAccountModel.findOne({ _id: params.id, userId: await uid() });
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (parsed.name !== undefined) doc.name = parsed.name;
    if (parsed.bank !== undefined) doc.bank = parsed.bank;
    if (parsed.ratePercent !== undefined) doc.ratePercent = parsed.ratePercent;
    if (parsed.anchorDate !== undefined) doc.anchorDate = parsed.anchorDate;
    if (parsed.anchorBalance !== undefined) doc.anchorBalance = parsed.anchorBalance;
    if (parsed.notes !== undefined) doc.notes = parsed.notes;
    if (parsed.addMovement) doc.movements.push(parsed.addMovement as any);

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
  const doc = await SavingsAccountModel.findOneAndDelete({ _id: params.id, userId: await uid() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
