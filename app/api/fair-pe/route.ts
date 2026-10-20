import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uid } from "@/lib/auth/uid";
import { getFairPeInputs, saveFairPeInputs } from "@/lib/fair-pe/data";

export const dynamic = "force-dynamic";

// The rates you enter on the Fair P/E page: for now (with any extra risk) and
// for each 30 June (an empty field is null: the app's own figure is used),
// the years left out of the lines and the shares shown besides those held.
const pct = z.number().min(-50).max(200).nullable().optional();
const macro = z.object({ tbill: pct, policy: pct, cpi: pct });
const schema = z.object({
  now: macro.extend({ extraRisk: z.number().min(-20).max(50).nullable().optional() }),
  years: z.record(z.string().regex(/^\d{4}$/), macro),
  skip: z.array(z.string().regex(/^\d{4}$/)).max(40).optional(),
  watch: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9.&-]{1,12}$/)).max(20).optional(),
});

export async function GET() {
  return NextResponse.json(await getFairPeInputs());
}

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  await saveFairPeInputs(await uid(), parsed.data);
  return NextResponse.json({ ok: true });
}
