// The evening after the close, in order: the exchange's end-of-day files into
// the stored price series, the index board into the stored index series,
// then for each user the model's reading rebuilt on them. The timer's route
// and the page's rebuild button both come through here, so they cannot drift.

import "server-only";
import { runAsUser } from "@/lib/auth/current-user";
import { buildQuantReport } from "./report";
import { ingestSheets, applySheetsToBars, type IngestResult, type ApplyResult } from "./sheet-bars";
import { updateIndexSeries, type IndexUpdate } from "./index-bars";
import { loadQuantSnapshot, saveQuantSnapshot } from "./store";

export async function refreshCloses(o: { from?: string } = {}): Promise<{ sheets: IngestResult; bars: ApplyResult; indices: IndexUpdate[] }> {
  const sheets = await ingestSheets({ from: o.from });
  const bars = await applySheetsToBars();
  const indices = await updateIndexSeries().catch((e) => [{ code: "*", from: null, to: null, added: 0, rebuilt: [], note: String(e instanceof Error ? e.message : e).slice(0, 160) }]);
  return { sheets, bars, indices };
}

// The latest close a user's reading was rebuilt on, so the evening's second
// run can skip them.
const rebuiltKey = (userId: string) => `quant:rebuilt:${userId}`;

export async function rebuiltThrough(userId: string): Promise<string | null> {
  const m = await loadQuantSnapshot<{ asOf: string }>(rebuiltKey(userId)).catch(() => null);
  return m?.asOf ?? null;
}

export type UserRebuild = { charts: number };

export async function rebuildUser(userId: string, latest?: string | null): Promise<UserRebuild> {
  return runAsUser(userId, async () => {
    const report = await buildQuantReport();
    if (latest) await saveQuantSnapshot(rebuiltKey(userId), { asOf: latest }, `rebuilt on the close of ${latest}`).catch(() => {});
    return { charts: report.indices.length + report.holdings.length };
  });
}
