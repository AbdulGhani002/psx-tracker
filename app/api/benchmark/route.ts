import { NextRequest, NextResponse } from "next/server";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { computeBenchmark, benchmarkKey } from "@/lib/feeds/benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

// The benchmark needs many live external fetches (PSX EOD for KSE100/KMI30 + each
// held symbol, Yahoo for USD/PKR + S&P). That's slow (2-6s) and, if any critical
// fetch blips, buildBenchmarkSeries returns null and the chart would go blank.
// So we cache the result per range and serve the last-good snapshot instantly,
// only recomputing when stale — and if a recompute fails, we fall back to the
// stored snapshot instead of showing "unavailable".
const FRESH_MS = 3 * 60 * 60 * 1000; // serve cache without recomputing for 3h

export async function GET(req: NextRequest) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rangeKey = req.nextUrl.searchParams.get("range") ?? "90D";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const key = `${benchmarkKey(rangeKey)}:${uid}`;

  const cached = await getFeedSnapshot<any>(key);
  const fresh = cached.data && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < FRESH_MS;
  if (!force && fresh) {
    return NextResponse.json({ ...cached.data, cached: true, updatedAt: cached.updatedAt });
  }

  // Recompute live; on success store it for next time.
  try {
    const series = await computeBenchmark(rangeKey);
    if (series && series.points.length > 0) {
      await saveFeedSnapshot(key, series, "ok").catch(() => {});
      return NextResponse.json({ ...series, cached: false });
    }
  } catch {
    /* fall through to stale snapshot */
  }

  // Live failed (or returned nothing) — serve the last-good snapshot if we have
  // one, so a transient PSX/Yahoo outage never blanks the chart.
  if (cached.data) {
    return NextResponse.json({ ...cached.data, cached: true, stale: true, updatedAt: cached.updatedAt });
  }
  return NextResponse.json({ error: "no_data" }, { status: 404 });
}
