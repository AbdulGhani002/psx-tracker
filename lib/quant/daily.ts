// The evening after the close, in order: the exchange's end-of-day files into
// the stored price series, then the index board into the stored index series.
// The timer's route and the home machine's hand-over both come through here,
// so they cannot drift.

import "server-only";
import { ingestSheets, applySheetsToBars, type IngestResult, type ApplyResult } from "./sheet-bars";
import { updateIndexSeries, type IndexUpdate } from "./index-bars";

export async function refreshCloses(o: { from?: string } = {}): Promise<{ sheets: IngestResult; bars: ApplyResult; indices: IndexUpdate[] }> {
  const sheets = await ingestSheets({ from: o.from });
  const bars = await applySheetsToBars();
  const indices = await updateIndexSeries().catch((e) => [{ code: "*", from: null, to: null, added: 0, rebuilt: [], note: String(e instanceof Error ? e.message : e).slice(0, 160) }]);
  return { sheets, bars, indices };
}
