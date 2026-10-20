// The dividend record, kept growing from the exchange's closing files. On a
// day whose last-day closing price (LDCP) sits under the close before, the
// share went ex something: a cash dividend, a bonus or a split
// (lib/quant/events.ts reads which). Each kept file is set against the one
// before it when no unknown weekday lies between, so a run can go back over
// days already read; the events land in ShareEvent with the archive's.

import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models/FeedSnapshot";
import { ShareEventModel } from "@/lib/models/ShareEvent";
import type { DayRow } from "@/lib/timeseries/psx-history";
import { classifyAction } from "./events";
import { SHEET_PREFIX, unknownDaysBetween } from "./sheet-bars";

export type SheetEvent = { symbol: string; date: string; kind: "cash" | "bonus" | "split"; cash: number; yieldPct: number; ratioPct: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

// `known` is every weekday accounted for: a kept file or a known holiday.
export function eventsFromSheets(sheets: Array<{ date: string; rows: DayRow[] }>, known: Set<string>, threshold = 0.005): SheetEvent[] {
  const out: SheetEvent[] = [];
  for (let i = 1; i < sheets.length; i++) {
    const prev = sheets[i - 1], cur = sheets[i];
    if (unknownDaysBetween(prev.date, cur.date, known) > 0) continue;
    const closeBefore = new Map(prev.rows.map((r) => [r[0], r[4]]));
    for (const r of cur.rows) {
      const close = closeBefore.get(r[0]) ?? 0, ldcp = r[6];
      if (!(close > 0) || !(ldcp > 0)) continue;
      const f = ldcp / close;
      if (Math.abs(f - 1) <= threshold || f < 0.005 || f > 200) continue;
      const a = classifyAction(close, ldcp);
      if (a.kind === "other") continue;
      out.push({ symbol: r[0], date: cur.date, kind: a.kind, cash: r2(a.cash), yieldPct: a.kind === "cash" ? r2((a.cash / close) * 100) : 0, ratioPct: Math.round(a.ratioPct * 10) / 10 });
    }
  }
  return out;
}

// The kept files of the last `days` days, read again each evening.
export async function recordSheetEvents(days = 30): Promise<{ files: number; events: number; latest: string | null }> {
  await connectDb();
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const docs = (await FeedSnapshotModel.find({ key: { $gte: SHEET_PREFIX + from, $lt: SHEET_PREFIX + "~" } }, { key: 1, "data.date": 1, "data.rows": 1 }).sort({ key: 1 }).lean()) as any[];
  const dateOf = (d: any) => String(d.data?.date ?? String(d.key).slice(SHEET_PREFIX.length));
  const known = new Set(docs.map(dateOf));
  const sheets = docs.map((d) => ({ date: dateOf(d), rows: (d.data?.rows ?? []) as DayRow[] })).filter((s) => s.rows.length > 0);
  const events = eventsFromSheets(sheets, known);
  for (const e of events) {
    await ShareEventModel.updateOne({ symbol: e.symbol, date: e.date }, { $set: { kind: e.kind, cash: e.cash, yieldPct: e.yieldPct, ratioPct: e.ratioPct, source: "sheet" } }, { upsert: true }).catch(() => {});
  }
  return { files: sheets.length, events: events.length, latest: sheets.length ? sheets[sheets.length - 1].date : null };
}
