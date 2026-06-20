import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { CashEntryModel, CASH_ENTRY_TYPES, TransactionModel } from "@/lib/models";
import { computeCashBalance } from "@/lib/calculations";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  date: z.string().or(z.date()).optional(),
  type: z.enum(CASH_ENTRY_TYPES),
  amount: z.number().positive(),
  notes: z.string().default(""),
});

export async function GET() {
  await connectDb();
  const [entries, txs] = await Promise.all([
    CashEntryModel.find({ userId: await uid() }).sort({ date: -1, createdAt: -1 }).lean(),
    TransactionModel.find({ userId: await uid(), deletedAt: null }).lean(),
  ]);
  const summary = computeCashBalance(txs as any, entries as any);
  return NextResponse.json({ entries, summary });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = postSchema.parse(body);
    await connectDb();
    const created = await CashEntryModel.create({
      userId: await uid(),
      date: parsed.date ? new Date(parsed.date) : new Date(),
      type: parsed.type,
      amount: parsed.amount,
      notes: parsed.notes,
    });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
