// The evening after the close, in order: the exchange's end-of-day files into
// the stored price series, the index board into the stored index series,
// then for each user the model's reading rebuilt on them, then the swing book
// moved on by that reading. The timer's route and
// the page's rebuild button both come through here, so they cannot drift.

import "server-only";
import { runAsUser } from "@/lib/auth/current-user";
import { buildQuantReport } from "./report";
import { ingestSheets, applySheetsToBars, type IngestResult, type ApplyResult } from "./sheet-bars";
import { updateIndexSeries, type IndexUpdate } from "./index-bars";
import { updateSwingBook, type BookUpdate } from "./swing-book";

export async function refreshCloses(o: { from?: string } = {}): Promise<{ sheets: IngestResult; bars: ApplyResult; indices: IndexUpdate[] }> {
  const sheets = await ingestSheets({ from: o.from });
  const bars = await applySheetsToBars();
  const indices = await updateIndexSeries().catch((e) => [{ code: "*", from: null, to: null, added: 0, rebuilt: [], note: String(e instanceof Error ? e.message : e).slice(0, 160) }]);
  return { sheets, bars, indices };
}

export type UserRebuild = { charts: number; book: BookUpdate | null; bookError?: string };

export async function rebuildUser(userId: string): Promise<UserRebuild> {
  return runAsUser(userId, async () => {
    const report = await buildQuantReport();
    let book: BookUpdate | null = null;
    let bookError: string | undefined;
    try {
      book = await updateSwingBook(userId, report);
    } catch (e) {
      bookError = String(e instanceof Error ? e.message : e).slice(0, 200);
    }
    return { charts: report.indices.length + report.holdings.length, book, bookError };
  });
}
