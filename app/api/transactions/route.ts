import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel, TRANSACTION_TYPES } from "@/lib/models";
import { getSectorInfo } from "@/lib/sectors";
import { deriveFromTransactions } from "@/lib/calculations";

export const dynamic = "force-dynamic";

const txSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  type: z.enum(TRANSACTION_TYPES),
  date: z.string().or(z.date()),
  shares: z.number().default(0),
  pricePerShare: z.number().default(0),
  fees: z.number().default(0),
  notes: z.string().default(""),
  ratio: z.string().default(""),
});

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

export async function GET(req: NextRequest) {
  await connectDb();
  const symbol = req.nextUrl.searchParams.get("symbol");
  const type = req.nextUrl.searchParams.get("type");
  const filter: Record<string, unknown> = {};
  if (symbol) filter.symbol = symbol.toUpperCase();
  if (type) filter.type = type;
  const docs = await TransactionModel.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  return NextResponse.json({ transactions: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = txSchema.parse(body);
    await connectDb();

    let holding = await HoldingModel.findOne({ symbol: parsed.symbol });
    if (!holding) {
      const info = getSectorInfo(parsed.symbol);
      holding = await HoldingModel.create({
        symbol: parsed.symbol,
        name: info.name,
        sector: info.sector,
        shariaCompliant: info.shariaCompliant,
      });
    }

    // Sign shares: SELL stores negative shares to make queries simpler.
    let signedShares = parsed.shares;
    if (parsed.type === "SELL" && signedShares > 0) signedShares = -Math.abs(signedShares);

    const totalAmount = Math.abs(signedShares) * parsed.pricePerShare;
    let netAmount = totalAmount;
    if (parsed.type === "BUY" || parsed.type === "RIGHT") {
      netAmount = totalAmount + parsed.fees;
    } else if (parsed.type === "SELL") {
      netAmount = totalAmount - parsed.fees;
    } else if (parsed.type === "DIVIDEND") {
      // pricePerShare = DPS, shares = held shares at record date
      netAmount = Math.abs(signedShares) * parsed.pricePerShare - parsed.fees;
    } else {
      // BONUS / SPLIT — no cash impact
      netAmount = 0;
    }

    const created = await TransactionModel.create({
      symbol: parsed.symbol,
      type: parsed.type,
      date: new Date(parsed.date),
      shares: parsed.type === "SELL" ? signedShares : Math.abs(signedShares),
      pricePerShare: parsed.pricePerShare,
      totalAmount,
      fees: parsed.fees,
      netAmount,
      notes: parsed.notes,
      ratio: parsed.ratio,
    });

    await recomputeHolding(parsed.symbol);
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
