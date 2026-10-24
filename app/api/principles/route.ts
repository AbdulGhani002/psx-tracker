import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { getPrinciples, savePrinciples } from "@/lib/principles";

export const dynamic = "force-dynamic";

// Your principles (lib/principles): an answer to each question.
const schema = z.object({ answers: z.record(z.string().max(40), z.string().max(2000)) });

export async function GET() {
  return NextResponse.json(await getPrinciples());
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  await savePrinciples(await uid(), parsed.data.answers);
  return NextResponse.json({ ok: true });
}
