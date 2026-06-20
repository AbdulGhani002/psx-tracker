import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { MutualFundModel } from "@/lib/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const postSchema = z.object({
  name: z.string().min(1),
  mufapName: z.string().min(1),
  amc: z.string().default(""),
  units: z.number().min(0),
  avgCost: z.number().min(0).default(0),
  fundType: z.enum(["growth", "dailyDividend"]).default("growth"),
  annualYieldPct: z.number().min(0).max(100).default(0),
  anchorDate: z.string().default(""),
  notes: z.string().default(""),
});

export async function GET() {
  await connectDb();
  const docs = await MutualFundModel.find({ userId: await uid() }).sort({ name: 1 }).lean();
  return NextResponse.json({ funds: docs });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = postSchema.parse(await req.json());
    await connectDb();
    const created = await MutualFundModel.create({ ...parsed, userId: await uid() });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
