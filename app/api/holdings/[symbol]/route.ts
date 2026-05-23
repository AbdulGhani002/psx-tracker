import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().optional(),
  sector: z.string().optional(),
  shariaCompliant: z.boolean().optional(),
  targetAllocationPercent: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

type Params = { params: { symbol: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  await connectDb();
  const doc = await HoldingModel.findOne({ symbol: params.symbol.toUpperCase() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    await connectDb();
    const updated = await HoldingModel.findOneAndUpdate(
      { symbol: params.symbol.toUpperCase() },
      parsed,
      { new: true }
    ).lean();
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDb();
  const symbol = params.symbol.toUpperCase();
  const txCount = await TransactionModel.countDocuments({ symbol });
  if (txCount > 0) {
    return NextResponse.json(
      { error: "has_transactions", count: txCount },
      { status: 400 }
    );
  }
  const deleted = await HoldingModel.findOneAndDelete({ symbol }).lean();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true, symbol });
}
