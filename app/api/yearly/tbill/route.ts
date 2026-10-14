import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { saveYearTbill } from "@/lib/analytics/fy";

export const dynamic = "force-dynamic";

// The 12-month T-bill rate on a financial year's first day, for the Yearly
// tab's comparison; null clears it.
const schema = z.object({ endYear: z.number().int().min(2000).max(2100), pct: z.number().min(0).max(60).nullable() });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await connectDb();
  await saveYearTbill(parsed.data.endYear, parsed.data.pct);
  return NextResponse.json({ ok: true });
}
