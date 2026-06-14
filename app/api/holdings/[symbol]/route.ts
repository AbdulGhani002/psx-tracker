import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";

export const dynamic = "force-dynamic";

const metricSchema = z.object({
  name: z.string().default(""),
  source: z.string().default(""),
  green: z.string().default(""),
  red: z.string().default(""),
  current: z.string().default(""),
});

const patchSchema = z.object({
  name: z.string().optional(),
  sector: z.string().optional(),
  shariaCompliant: z.boolean().optional(),
  targetAllocationPercent: z.number().min(0).max(100).optional(),
  rebalanceBand: z.number().min(0).max(50).optional(),
  targetRationale: z.string().optional(),
  notes: z.string().optional(),
  refreshFromPSX: z.boolean().optional(),
  // Playbook
  tier: z.string().optional(),
  convictionScore: z.number().min(0).max(25).optional(),
  goalTag: z.string().optional(),
  thesis: z.string().optional(),
  trackedMetrics: z.array(metricSchema).optional(),
  modelAssumptions: z
    .object({
      mode: z.enum(["eps", "nav"]).optional(),
      annualGrowth: z.number().optional(),
      peStart: z.number().optional(),
      peEnd: z.number().optional(),
      payoutRatio: z.number().optional(),
      navDiscount: z.number().optional(),
      horizonYears: z.number().optional(),
      useDRIP: z.boolean().optional(),
      saved: z.boolean().optional(),
    })
    .optional(),
  dividendOverride: z
    .object({
      parValue: z.number().min(0).optional(),
      cadence: z.enum(["", "annual", "semi-annual", "quarterly"]).optional(),
      payoutRatioPct: z.number().min(0).max(500).optional(),
      expectedAnnualDps: z.number().min(0).optional(),
    })
    .optional(),
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
    const symbol = params.symbol.toUpperCase();
    const body = await req.json();
    const parsed = patchSchema.parse(body);
    await connectDb();

    const update: Record<string, unknown> = { ...parsed };
    delete update.refreshFromPSX;

    if (parsed.refreshFromPSX) {
      const info = await getCompanyInfo(symbol);
      if (info) {
        if (info.name && !parsed.name) update.name = info.name;
        if (info.sector && !parsed.sector) update.sector = info.sector;
      }
    }

    const updated = await HoldingModel.findOneAndUpdate({ symbol }, update, { new: true }).lean();
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
  const txCount = await TransactionModel.countDocuments({ symbol, deletedAt: null });
  if (txCount > 0) {
    return NextResponse.json(
      { error: "has_transactions", count: txCount, message: "Delete this holding's transactions first." },
      { status: 400 }
    );
  }
  const deleted = await HoldingModel.findOneAndDelete({ symbol }).lean();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true, symbol });
}
