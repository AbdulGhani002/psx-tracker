import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel } from "@/lib/models";
import { getSectorInfo } from "@/lib/sectors";

export const dynamic = "force-dynamic";

const holdingSchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  name: z.string().optional(),
  sector: z.string().optional(),
  shariaCompliant: z.boolean().optional(),
  targetAllocationPercent: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export async function GET() {
  await connectDb();
  const docs = await HoldingModel.find().sort({ symbol: 1 }).lean();
  return NextResponse.json({ holdings: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = holdingSchema.parse(body);
    await connectDb();
    const exists = await HoldingModel.findOne({ symbol: parsed.symbol });
    if (exists) {
      return NextResponse.json({ error: "exists", symbol: parsed.symbol }, { status: 409 });
    }
    const info = getSectorInfo(parsed.symbol);
    const created = await HoldingModel.create({
      symbol: parsed.symbol,
      name: parsed.name ?? info.name,
      sector: parsed.sector ?? info.sector,
      shariaCompliant: parsed.shariaCompliant ?? info.shariaCompliant,
      targetAllocationPercent: parsed.targetAllocationPercent ?? 0,
      notes: parsed.notes ?? "",
    });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
