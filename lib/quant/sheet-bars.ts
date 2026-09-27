// The server's daily bars, kept current from the exchange's end-of-day file.
//
// Every weekday after the close the day's file (lib/timeseries/dps-sheet.ts)
// is fetched and kept as it came, one document per day (dps:closing:DATE), and
// each stock series the report reads (eod:bars:SYMBOL, seeded from the
// adjusted 24-year archive) gets the new days appended. The series are
// adjusted the way the archive is (archive.ts, adjustedSeries): where a day's
// LDCP differs from the series' last close by more than half a percent, a
// bonus or a split went ex, and every earlier price is scaled by that ratio.
// A day missing from a series would read as an adjustment, so before a day
// is appended it is checked two ways: the file against the one before it (a
// quarter of the names disagreeing means a whole trading day was missed), and
// the series against the calendar (a weekday between its last bar and this
// day with neither a file nor a known holiday means the series itself has a
// hole: it was pushed, or last updated, before that day). After either, only
// a change no few sessions' moves could explain (a quarter or more) counts as
// an action. A weekday with no file is recorded as a holiday once a later
// day's file has come in, so the day after a holiday is read normally.
//
// The stored days are the record: a series pushed again from the archive, or
// a day fetched late, is brought up to date on the next run from them. The
// indices have no line in the file and are left as they are.

import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models/FeedSnapshot";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import { weekdaysBetween, type DayRow } from "@/lib/timeseries/psx-history";
import { fetchClosingSheet } from "@/lib/timeseries/dps-sheet";

export const SHEET_PREFIX = "dps:closing:";
export const SHEET_SOURCE = "dps-sheet";

// Today in Karachi, where the market's dates are.
export const pktToday = (now = Date.now()) => new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);

const nextDay = (date: string) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// What one day did to one series.
export type AppendOutcome = "appended" | "adjusted" | "skipped";

// Appends a day to an adjusted series in place. `gap` says the file follows a
// missing day, so only an unmistakable action is taken for one.
export function appendSheetDay(bars: EodBar[], date: string, row: DayRow, gap = false, threshold = 0.005): AppendOutcome {
  const last = bars[bars.length - 1];
  const [, , h, l, c, v, ldcp] = row;
  if (!last || date <= last.date || !(c > 0)) return "skipped";
  let adjusted = false;
  if (ldcp > 0 && last.close > 0) {
    const f = ldcp / last.close;
    const action = gap ? f < 0.75 || f > 1.34 : Math.abs(f - 1) > threshold;
    if (action && f > 0.005 && f < 200) {
      for (const b of bars) {
        b.close *= f;
        b.vwap *= f;
        b.volume = b.volume / f;
      }
      adjusted = true;
    }
  }
  bars.push({ date, close: c, volume: v > 0 ? v : 0, vwap: h > 0 && l > 0 ? (h + l + c) / 3 : c });
  return adjusted ? "adjusted" : "appended";
}

// Whether a file follows a missing trading day: its LDCPs against the closes
// the names last had. Real actions touch a handful of names on a day.
export function followsGap(rows: DayRow[], lastClose: Map<string, number>, share = 0.25): boolean {
  let compared = 0, off = 0;
  for (const [symbol, , , , , , ldcp] of rows) {
    const prev = lastClose.get(symbol);
    if (!prev || !(ldcp > 0)) continue;
    compared++;
    if (Math.abs(ldcp / prev - 1) > 0.005) off++;
  }
  return compared >= 30 && off / compared > share;
}

// Weekdays strictly between a series' last bar and a new day that are neither
// a kept file nor a known holiday: days the series may have missed.
export function unknownDaysBetween(last: string, date: string, known: Set<string>): number {
  if (date <= last) return 0;
  return weekdaysBetween(nextDay(last), date).filter((d) => d < date && !known.has(d)).length;
}

export type IngestResult = { fetched: string[]; missing: string[]; holidays: string[]; errors: string[]; latest: string | null };

// Fetches every weekday's file not yet kept, from the day after the latest
// one kept (or after the series' last day, the first time) through today.
// A weekday with no file is a holiday or not yet published; it is asked for
// again on the next run until a later day is in.
export async function ingestSheets(o: { from?: string; today?: string; pauseMs?: number; maxDays?: number } = {}): Promise<IngestResult> {
  await connectDb();
  const today = o.today ?? pktToday();
  const latestDoc: any = await FeedSnapshotModel.findOne({ key: { $regex: "^" + SHEET_PREFIX } }, { key: 1 }).sort({ key: -1 }).lean();
  const latestKept: string | null = latestDoc ? String(latestDoc.key).slice(SHEET_PREFIX.length) : null;
  let from = o.from;
  if (!from) {
    const base = latestKept ?? (await lastBarsDate());
    from = base ? nextDay(base) : today;
  }
  const kept = new Set(
    ((await FeedSnapshotModel.find({ key: { $regex: "^" + SHEET_PREFIX } }, { key: 1 }).lean()) as any[]).map((d) => String(d.key).slice(SHEET_PREFIX.length))
  );
  const dates = weekdaysBetween(from, today).filter((d) => !kept.has(d)).slice(-(o.maxDays ?? 30));
  const out: IngestResult = { fetched: [], missing: [], holidays: [], errors: [], latest: latestKept };
  for (const d of dates) {
    const r = await fetchClosingSheet(d);
    if (r.status === "ok") {
      await FeedSnapshotModel.findOneAndUpdate(
        { key: SHEET_PREFIX + d },
        { key: SHEET_PREFIX + d, data: { date: d, rows: r.rows }, status: "ok", note: `${r.rows.length} names`, updatedAt: new Date() },
        { upsert: true }
      );
      out.fetched.push(d);
      if (!out.latest || d > out.latest) out.latest = d;
    } else if (r.status === "missing") out.missing.push(d);
    else out.errors.push(`${d}: ${r.detail}`);
    if (o.pauseMs !== 0) await new Promise((res) => setTimeout(res, o.pauseMs ?? 1500));
  }
  // A weekday with no file before a day that has one was not a trading day.
  for (const d of out.missing.filter((m) => out.latest != null && m < out.latest)) {
    await FeedSnapshotModel.findOneAndUpdate(
      { key: SHEET_PREFIX + d },
      { key: SHEET_PREFIX + d, data: { date: d, rows: [], holiday: true }, status: "holiday", note: "no file: not a trading day", updatedAt: new Date() },
      { upsert: true }
    );
    out.holidays.push(d);
  }
  out.missing = out.missing.filter((m) => !out.holidays.includes(m));
  return out;
}

type SeriesHead = { symbol: string; date: string; close: number };

// The last bar of every stored series, without reading the series.
async function seriesHeads(): Promise<SeriesHead[]> {
  const docs = (await FeedSnapshotModel.aggregate([{ $match: { key: { $regex: "^eod:bars:" } } }, { $project: { key: 1, last: { $arrayElemAt: ["$data.bars", -1] } } }])) as any[];
  const out: SeriesHead[] = [];
  for (const d of docs) {
    const b = d?.last;
    if (b && typeof b.date === "string" && b.close > 0) out.push({ symbol: String(d.key).slice("eod:bars:".length), date: b.date, close: b.close });
  }
  return out;
}

async function lastBarsDate(): Promise<string | null> {
  const heads = await seriesHeads();
  return heads.length ? heads.map((h) => h.date).sort().pop()! : null;
}

export type ApplyResult = { days: string[]; series: number; appended: number; adjusted: string[]; gaps: string[]; latest: string | null };

// Brings every stored stock series up to the latest kept day.
export async function applySheetsToBars(): Promise<ApplyResult> {
  await connectDb();
  const heads = await seriesHeads();
  const out: ApplyResult = { days: [], series: 0, appended: 0, adjusted: [], gaps: [], latest: null };
  if (heads.length === 0) return out;
  const oldest = heads.map((h) => h.date).sort()[0];
  const sheetDocs = (await FeedSnapshotModel.find({ key: { $gt: SHEET_PREFIX + oldest, $lt: SHEET_PREFIX + "~" } }).sort({ key: 1 }).lean()) as any[];
  // Every weekday the calendar accounts for: a file, or a known holiday.
  const known = new Set(sheetDocs.map((d) => String(d.data?.date ?? String(d.key).slice(SHEET_PREFIX.length))));
  const sheets = sheetDocs
    .map((d) => ({ date: String(d.data?.date ?? String(d.key).slice(SHEET_PREFIX.length)), rows: (d.data?.rows ?? []) as DayRow[] }))
    .filter((s) => s.rows.length > 0);
  if (sheets.length === 0) return out;
  out.days = sheets.map((s) => s.date);
  out.latest = sheets[sheets.length - 1].date;

  // Which days follow a gap: each file against the closes before it, starting
  // from the series' own last closes.
  const lastClose = new Map<string, number>();
  const headDate = new Map<string, string>();
  for (const h of heads) {
    lastClose.set(h.symbol, h.close);
    headDate.set(h.symbol, h.date);
  }
  const gapDay = new Set<string>();
  for (const s of sheets) {
    const ref = new Map<string, number>();
    // Only names whose last close is from before this day can vouch for it.
    for (const [sym, c] of lastClose) if ((headDate.get(sym) ?? "") < s.date) ref.set(sym, c);
    if (followsGap(s.rows, ref)) {
      gapDay.add(s.date);
      out.gaps.push(s.date);
    }
    for (const r of s.rows) {
      lastClose.set(r[0], r[4]);
      headDate.set(r[0], s.date);
    }
  }

  const bySheet = sheets.map((s) => ({ date: s.date, gap: gapDay.has(s.date), row: new Map(s.rows.map((r) => [r[0], r])) }));
  for (const h of heads) {
    if (h.date >= out.latest) continue;
    if (!bySheet.some((s) => s.date > h.date && s.row.has(h.symbol))) continue;
    const doc: any = await FeedSnapshotModel.findOne({ key: `eod:bars:${h.symbol}` }).lean();
    const bars = (doc?.data?.bars ?? []) as EodBar[];
    if (bars.length === 0) continue;
    let added = 0;
    for (const s of bySheet) {
      const row = s.row.get(h.symbol);
      if (!row) continue;
      const r = appendSheetDay(bars, s.date, row, s.gap || unknownDaysBetween(bars[bars.length - 1].date, s.date, known) > 0);
      if (r !== "skipped") added++;
      if (r === "adjusted") out.adjusted.push(`${h.symbol} ${s.date}`);
    }
    if (added === 0) continue;
    await FeedSnapshotModel.updateOne(
      { key: `eod:bars:${h.symbol}` },
      {
        $set: {
          data: { fetchedAt: new Date().toISOString(), bars, source: SHEET_SOURCE },
          status: "ok",
          note: `${bars.length} sessions to ${bars[bars.length - 1].date} (dps sheet)`,
          updatedAt: new Date(),
        },
      }
    );
    out.series++;
    out.appended += added;
  }
  return out;
}

// Stored series for a few names, however old.
export async function loadStoredBars(symbols: string[]): Promise<Map<string, EodBar[]>> {
  await connectDb();
  const docs = (await FeedSnapshotModel.find({ key: { $in: [...new Set(symbols)].map((s) => `eod:bars:${s}`) } }).lean()) as any[];
  const out = new Map<string, EodBar[]>();
  for (const d of docs) {
    const bars = d?.data?.bars;
    if (Array.isArray(bars) && bars.length > 0) out.set(String(d.key).slice("eod:bars:".length), bars as EodBar[]);
  }
  return out;
}

// The kept days, for the machine that trains to extend its archive with.
export async function loadSheets(from: string): Promise<Array<{ date: string; rows: DayRow[] }>> {
  await connectDb();
  const docs = (await FeedSnapshotModel.find({ key: { $gte: SHEET_PREFIX + from, $lt: SHEET_PREFIX + "~" }, status: "ok" }).sort({ key: 1 }).lean()) as any[];
  return docs.map((d) => ({ date: String(d.data?.date), rows: (d.data?.rows ?? []) as DayRow[] })).filter((s) => s.rows.length > 0);
}
