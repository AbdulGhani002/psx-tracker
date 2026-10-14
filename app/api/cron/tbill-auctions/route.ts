import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { getTbillAuctions, refreshTbillAuctions } from "@/lib/feeds/tbill-auctions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: reads any T-bill auction reports not yet read, now rather
// than at the next six-hourly run, and returns the latest auctions kept.
export async function POST() {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const report = await refreshTbillAuctions(true);
  const kept = await getTbillAuctions();
  return NextResponse.json({ ok: true, report, latest: kept.slice(-6) });
}
