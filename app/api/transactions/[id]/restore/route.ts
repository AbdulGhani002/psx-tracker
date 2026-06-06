import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel } from "@/lib/models";
import { deriveFromTransactions } from "@/lib/calculations";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

async function recomputeHolding(symbol: string) {
  const txs = await TransactionModel.find({ symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean();
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

// POST /api/transactions/:id/restore — bring a soft-deleted transaction back.
export async function POST(_req: NextRequest, { params }: Params) {
  await connectDb();
  const doc = await TransactionModel.findById(params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!doc.deletedAt) {
    return NextResponse.json({ error: "not_deleted", detail: "This transaction is already active." }, { status: 400 });
  }

  // Restoring re-adds the row. Make sure that doesn't drive the holding negative
  // (e.g. restoring a SELL after the matching BUYs were also deleted).
  const active = await TransactionModel.find({ symbol: doc.symbol, deletedAt: null }).lean();
  const replayed = [...active, { ...doc.toObject(), deletedAt: null }].sort(
    (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const after = deriveFromTransactions(replayed as any);
  if (after.shares < -1e-6) {
    return NextResponse.json(
      { error: "would_oversell", detail: `Restoring would leave ${doc.symbol} at ${after.shares} shares. Restore the matching buys first.` },
      { status: 400 }
    );
  }

  doc.set("deletedAt", null);
  await doc.save();
  await recomputeHolding(doc.symbol);
  return NextResponse.json({ restored: true, id: params.id });
}
