import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { computeBenchmarkCached } from "@/lib/feeds/benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

// Thin wrapper over the shared cached benchmark builder (see lib/feeds/benchmark
// for the caching/fallback rationale). ?force=1 bypasses the 3h freshness.
export async function GET(req: NextRequest) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rangeKey = req.nextUrl.searchParams.get("range") ?? "90D";
  const force = req.nextUrl.searchParams.get("force") === "1";

  const r = await computeBenchmarkCached(rangeKey, uid, force);
  if (!r.series) return NextResponse.json({ error: "no_data" }, { status: 404 });
  return NextResponse.json({ ...r.series, cached: r.cached, ...(r.stale ? { stale: true } : {}), ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}) });
}
