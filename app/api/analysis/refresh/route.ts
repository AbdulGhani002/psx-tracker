import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { uid } from "@/lib/auth/uid";
import { buildQuantReport } from "@/lib/quant/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Rebuild the logged-in user's analysis and store it (buildQuantReport keeps
// it under quant:report:<userId>). Middleware already blocks callers without
// a session; the sentinel check is the belt to that brace.
export async function POST() {
  const userId = await uid();
  if (!userId || userId === "__no_user__") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  await connectDb();
  const t0 = Date.now();
  const report = await buildQuantReport();
  return NextResponse.json({ ok: true, date: report.date, charts: report.indices.length + report.holdings.length, seconds: Math.round((Date.now() - t0) / 1000) });
}
