import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { MutualFundModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  cashPlan: z
    .object({
      purpose: z.enum(["", "strategic_wait", "dry_powder", "emergency", "default_dump"]).default(""),
      reviewBy: z.string().default(""),
      reviewReason: z.string().max(300).default(""),
    })
    .optional(),

  name: z.string().optional(),
  units: z.number().min(0).optional(),
  avgCost: z.number().min(0).optional(),
  fundType: z.enum(["growth", "dailyDividend"]).optional(),
  annualYieldPct: z.number().min(0).max(100).optional(),
  anchorDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsed = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await MutualFundModel.findOneAndUpdate({ _id: params.id, userId: await uid() }, parsed, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await connectDb();
  const doc = await MutualFundModel.findOneAndDelete({ _id: params.id, userId: await uid() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
