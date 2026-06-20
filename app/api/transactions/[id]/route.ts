import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel, TRANSACTION_TYPES } from "@/lib/models";
import { deriveFromTransactions } from "@/lib/calculations";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

const patchSchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  date: z.string().or(z.date()).optional(),
  shares: z.number().optional(),
  pricePerShare: z.number().optional(),
  fees: z.number().optional(),
  notes: z.string().optional(),
  ratio: z.string().optional(),
  // Dividend-specific
  warrantNo: z.string().optional().nullable(),
  taxDeducted: z.number().optional(),
  zakatDeducted: z.number().optional(),
  financialYear: z.string().optional(),
  dividendType: z.string().optional(),
});

async function recomputeHolding(symbol: string) {
  const txs = await TransactionModel.find({ userId: await uid(), symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean();
  const derived = deriveFromTransactions(txs as any);
  await HoldingModel.findOneAndUpdate(
    { userId: await uid(), symbol },
    {
      currentShares: derived.shares,
      avgCostBasis: derived.avgCost,
      totalCost: derived.totalCost,
      realizedPL: derived.realizedPL,
      totalDividendsReceived: derived.dividendsReceived,
    }
  );
}

export async function GET(_req: NextRequest, { params }: Params) {
  await connectDb();
  const doc = await TransactionModel.findOne({ _id: params.id, userId: await uid() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    await connectDb();
    const existing = await TransactionModel.findOne({ _id: params.id, userId: await uid() });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Recompute derived monetary fields from the new inputs, preserving
    // anything the user didn't change.
    const type = parsed.type ?? existing.type;
    const shares = parsed.shares != null ? parsed.shares : existing.shares;
    const price = parsed.pricePerShare != null ? parsed.pricePerShare : existing.pricePerShare;
    const taxDeducted = parsed.taxDeducted != null ? parsed.taxDeducted : existing.taxDeducted ?? 0;
    const zakatDeducted = parsed.zakatDeducted != null ? parsed.zakatDeducted : existing.zakatDeducted ?? 0;

    // For DIVIDEND, fees field is the sum of tax+zakat; auto-keep them in sync.
    let fees: number;
    if (type === "DIVIDEND") {
      fees = taxDeducted + zakatDeducted;
    } else {
      fees = parsed.fees != null ? parsed.fees : existing.fees;
    }

    let signedShares = shares;
    if (type === "SELL" && signedShares > 0) signedShares = -Math.abs(signedShares);
    else if (type !== "SELL") signedShares = Math.abs(signedShares);

    const totalAmount = Math.abs(signedShares) * price;
    let netAmount = totalAmount;
    if (type === "BUY" || type === "RIGHT") netAmount = totalAmount + fees;
    else if (type === "SELL") netAmount = totalAmount - fees;
    else if (type === "DIVIDEND") netAmount = totalAmount - fees;
    else netAmount = 0;

    // Guard: replay the whole symbol with this edit applied and reject if it
    // ever drives the holding negative (e.g. enlarging a SELL past what's held).
    {
      const candidateDate = parsed.date ? new Date(parsed.date as any) : existing.date;
      const siblings = await TransactionModel.find({ userId: await uid(), symbol: existing.symbol, deletedAt: null }).lean();
      const replayed = siblings
        .map((t: any) =>
          String(t._id) === String(existing._id)
            ? { ...t, type, shares: signedShares, date: candidateDate, ratio: parsed.ratio ?? t.ratio }
            : t
        )
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const after = deriveFromTransactions(replayed as any);
      if (after.shares < -1e-6) {
        return NextResponse.json(
          { error: "oversell", detail: `This edit would leave ${existing.symbol} at ${after.shares} shares (negative).` },
          { status: 400 }
        );
      }
    }

    existing.type = type;
    if (parsed.date) existing.date = new Date(parsed.date as any);
    existing.shares = signedShares;
    existing.pricePerShare = price;
    existing.fees = fees;
    existing.totalAmount = totalAmount;
    existing.netAmount = netAmount;
    if (parsed.notes !== undefined) existing.notes = parsed.notes;
    if (parsed.ratio !== undefined) existing.ratio = parsed.ratio;
    if (parsed.warrantNo !== undefined) {
      const v = (parsed.warrantNo ?? "").trim();
      if (v) existing.warrantNo = v;
      else existing.set("warrantNo", undefined); // unset so partial index ignores it
    }
    if (parsed.taxDeducted !== undefined) existing.taxDeducted = parsed.taxDeducted;
    if (parsed.zakatDeducted !== undefined) existing.zakatDeducted = parsed.zakatDeducted;
    if (parsed.financialYear !== undefined) existing.financialYear = parsed.financialYear;
    if (parsed.dividendType !== undefined) existing.dividendType = parsed.dividendType;

    await existing.save();
    await recomputeHolding(existing.symbol);
    return NextResponse.json(existing.toObject());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  await connectDb();
  const hard = req.nextUrl.searchParams.get("hard") === "1" || req.nextUrl.searchParams.get("hard") === "true";

  if (hard) {
    // Permanent removal (used by the Trash "delete forever" action).
    const doc = await TransactionModel.findOneAndDelete({ _id: params.id, userId: await uid() }).lean();
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await recomputeHolding(doc.symbol);
    return NextResponse.json({ deleted: true, hard: true, id: params.id });
  }

  // Soft delete: mark and recompute so the holding ignores it immediately.
  const doc = await TransactionModel.findOne({ _id: params.id, userId: await uid() });
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  doc.set("deletedAt", new Date());
  await doc.save();
  await recomputeHolding(doc.symbol);
  return NextResponse.json({ deleted: true, soft: true, id: params.id });
}
