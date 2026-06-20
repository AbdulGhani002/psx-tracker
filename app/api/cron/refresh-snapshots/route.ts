import { NextResponse } from "next/server";
import { saveFeedSnapshot, warmPageCaches, getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { buildKse100SectorWeights, SECTOR_WEIGHTS_KEY } from "@/lib/feeds/sector-weights";
import { computeBenchmark, benchmarkKey, BENCHMARK_RANGES } from "@/lib/feeds/benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // first run fetches ~97 company pages

// Scheduled timer hits this. Recomputes heavy datasets in the background and
// stores ONE latest snapshot per key, so the UI serves them instantly. Each
// dataset is independent: a failure in one is recorded (status "error") and
// doesn't sink the others.
export async function POST() {
  const report: Record<string, unknown> = {};

  // KSE-100 sector weights (market-cap weighting from free PSX data).
  try {
    const snap = await buildKse100SectorWeights();
    await saveFeedSnapshot(SECTOR_WEIGHTS_KEY, snap, "ok", `${snap.priced}/${snap.members} members priced`);
    report[SECTOR_WEIGHTS_KEY] = { status: "ok", members: snap.members, priced: snap.priced, sectors: snap.sectors.length, missing: snap.missing.length };
  } catch (e) {
    const note = String(e).slice(0, 200);
    await saveFeedSnapshot(SECTOR_WEIGHTS_KEY, null, "error", note).catch(() => {});
    report[SECTOR_WEIGHTS_KEY] = { status: "error", note };
  }

  // Per-user warming: for every account, warm its page aggregates + its three
  // benchmark ranges, scoped via runAsUser so each user's caches stay isolated.
  const userIds = await getAllUserIds().catch(() => []);
  let warmed = 0;
  for (const uid of userIds) {
    try {
      await runAsUser(uid, async () => {
        await warmPageCaches();
        for (const range of BENCHMARK_RANGES) {
          try {
            const series = await computeBenchmark(range);
            if (series && series.points.length > 0) await saveFeedSnapshot(`${benchmarkKey(range)}:${uid}`, series, "ok");
          } catch {
            /* skip this range for this user */
          }
        }
      });
      warmed++;
    } catch {
      /* skip this user */
    }
  }
  report.usersWarmed = `${warmed}/${userIds.length}`;

  return NextResponse.json({ ok: true, report });
}
