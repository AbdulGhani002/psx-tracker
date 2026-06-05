import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { SavingsAccountModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  name: z.string().min(1),
  bank: z.string().default(""),
  ratePercent: z.number().min(0).max(100),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  anchorBalance: z.number().min(0),
  notes: z.string().default(""),
});

export async function GET() {
  await connectDb();
  const docs = await SavingsAccountModel.find().sort({ name: 1 }).lean();
  return NextResponse.json({ accounts: docs });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = postSchema.parse(await req.json());
    await connectDb();
    const created = await SavingsAccountModel.create(parsed);
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
