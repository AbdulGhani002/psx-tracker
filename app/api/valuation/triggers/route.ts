import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { ValuationTriggerModel } from "@/lib/models";

export const dynamic = "force-dynamic";

// A rule written in advance: a figure, a comparison, a threshold, an action.
const schema = z.object({
  symbol: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  metric: z.string().trim().min(1).max(40),
  op: z.enum([">=", "<=", ">", "<"]),
  threshold: z.number().finite(),
  action: z.enum(["trim", "exit", "buy", "review"]),
  note: z.string().max(200).default(""),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  await connectDb();
  const doc = await ValuationTriggerModel.create({ ...parsed.data, userId: await uid() });
  return NextResponse.json({ ok: true, id: String(doc._id) });
}
