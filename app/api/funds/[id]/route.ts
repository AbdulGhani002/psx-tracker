import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { MutualFundModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().optional(),
  units: z.number().min(0).optional(),
  avgCost: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = patchSchema.parse(await req.json());
    await connectDb();
    const doc = await MutualFundModel.findByIdAndUpdate(params.id, parsed, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const doc = await MutualFundModel.findByIdAndDelete(params.id).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
