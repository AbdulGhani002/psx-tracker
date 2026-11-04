// The evening after the close, in order: the exchange's end-of-day files into
// the stored price series, then the index board into the stored index series.
// The timer's route and the home machine's hand-over both come through here,
// so they cannot drift.

import "server-only";
import { connectDb } from "@/lib/db";
import { HoldingModel, PriceSnapshotModel } from "@/lib/models";
import { ingestSheets, applySheetsToBars, latestCloses, type IngestResult, type ApplyResult } from "./sheet-bars";
import { updateIndexSeries, type IndexUpdate } from "./index-bars";

// The official close of every share held, as its price: the one price the
// site keeps now, dated the afternoon of its day. Once a day each.
async function keepClosePrices(): Promise<void> {
  await connectDb();
  const [closes, held] = await Promise.all([latestCloses(), HoldingModel.distinct("symbol", { currentShares: { $gt: 0 } }) as Promise<string[]>]);
  for (const symbol of held) {
    const c = closes.get(symbol);
    if (!c) continue;
    const timestamp = new Date(c.date + "T11:00:00Z");
    await PriceSnapshotModel.updateOne({ symbol, source: "dps-close", asOf: c.date }, { $setOnInsert: { symbol, price: c.close, timestamp, source: "dps-close", isMarketHours: false, asOf: c.date } }, { upsert: true });
  }
}

export async function refreshCloses(o: { from?: string } = {}): Promise<{ sheets: IngestResult; bars: ApplyResult; indices: IndexUpdate[] }> {
  const sheets = await ingestSheets({ from: o.from });
  const bars = await applySheetsToBars();
  await keepClosePrices().catch(() => {});
  const indices = await updateIndexSeries().catch((e) => [{ code: "*", from: null, to: null, added: 0, rebuilt: [], note: String(e instanceof Error ? e.message : e).slice(0, 160) }]);
  return { sheets, bars, indices };
}
