import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel } from "@/lib/models";
import { deriveFromTransactions } from "@/lib/calculations";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

async function recomputeHolding(symbol: string) {
  const txs = await TransactionModel.find({ symbol }).sort({ date: 1, createdAt: 1 }).lean();
  const derived = deriveFromTransactions(txs as any);
  await HoldingModel.findOneAndUpdate(
    { symbol },
    {
      currentShares: derived.shares,
      avgCostBasis: derived.avgCost,
      totalCost: derived.totalCost,
      realizedPL: derived.realizedPL,
      totalDividendsReceived: derived.dividendsReceived,
    }
  );
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await connectDb();
  const doc = await TransactionModel.findByIdAndDelete(params.id).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await recomputeHolding(doc.symbol);
  return NextResponse.json({ deleted: true, id: params.id });
}
