import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { DecisionLogModel } from "@/lib/models";

export const dynamic = "force-dynamic";

const entrySchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase().trim()),
  date: z.string().or(z.date()),
  trigger: z.string().min(1),
  interpretation: z.string().min(1),
  action: z.string().min(1),
  positionBefore: z.number().default(0),
  positionAfter: z.number().default(0),
});

export async function GET(req: NextRequest) {
  await connectDb();
  const symbol = req.nextUrl.searchParams.get("symbol");
  const filter = symbol ? { symbol: symbol.toUpperCase() } : {};
  const docs = await DecisionLogModel.find({ ...filter, userId: await uid() }).sort({ date: -1 }).lean();
  return NextResponse.json({ entries: docs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = entrySchema.parse(body);
    await connectDb();
    const created = await DecisionLogModel.create({
      userId: await uid(),
      ...parsed,
      date: new Date(parsed.date),
    });
    return NextResponse.json(created.toObject(), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
