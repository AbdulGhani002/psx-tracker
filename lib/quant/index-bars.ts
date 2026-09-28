// The stored index series (eod:bars:KSE100, KMI30, KSE30), which the charts,
// the top bar's ticker and the report read, kept current from the exchange's
// index board (lib/timeseries/dps-indices.ts) each evening, after the day's
// stock file has come in (sheet-bars.ts).
//
// The board gives the official close of the session it is read after (its
// level) and of the session before (the level less its change). A session the
// job missed is rebuilt from the index's constituents: the value of their
// free-float shares at each day's closes, from the kept stock files. On 24
// and 25 September 2026 that reproduced the official closes of the KSE-100,
// KMI-30 and KSE-30 to the paisa. Rebuilt days are then fitted between the
// official closes either side of them, so the series passes through every
// official close it has. The volume is the constituents' volume, which is how
// the exchange's own series counts it.

import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models/FeedSnapshot";
import type { EodBar } from "@/lib/timeseries/psx-eod";
import type { DayRow } from "@/lib/timeseries/psx-history";
import { fetchIndexBoard, fetchIndexConstituents, type IndexBoard, type IndexConstituent } from "@/lib/timeseries/dps-indices";
import { SHEET_PREFIX, SHEET_SOURCE } from "./sheet-bars";
import { addSessions } from "./swing";

export const INDEX_SERIES = ["KSE100", "KMI30", "KSE30"];

// The official closes the board gives, for `session`, the latest day whose
// stock file is in: read after that session's close, its level is the close
// and the level less the change is the close before; read on the next session
// (before the open, when the change is nought, or during it), the level less
// the change is the session's close. A board as of any other day says nothing.
export function boardCloses(board: IndexBoard, code: string, session: string): { close: number; prevClose: number | null } | null {
  const row = board.rows.get(code);
  if (!row || !board.asOfDate) return null;
  if (board.asOfDate === session) return { close: row.current, prevClose: row.current - row.change };
  if (board.asOfDate === addSessions(session, 1)) return { close: row.current - row.change, prevClose: null };
  return null;
}

// One day's move of the index at fixed units: their value at the day's closes
// over their value at the closes before (LDCP, which the exchange adjusts on
// bonus and split ex-dates). A name with no line that day did not trade, and
// counts at its last close on both sides.
export function indexDayRatio(units: Map<string, number>, rows: Map<string, DayRow>, last: Map<string, number>): number {
  let now = 0, before = 0;
  for (const [s, n] of units) {
    const r = rows.get(s);
    if (r && r[4] > 0) {
      now += n * r[4];
      before += n * (r[6] > 0 ? r[6] : last.get(s) ?? r[4]);
    } else {
      const p = last.get(s) ?? 0;
      now += n * p;
      before += n * p;
    }
  }
  return before > 0 ? now / before : 1;
}

// Closes for `days` after a stored close. Each day's move is rebuilt from the
// constituents; between two official closes (`official`, date -> close) the
// moves are shifted equally, in log terms, so they compound exactly from one
// to the next, and an official day keeps its official close. Days after the
// last official close keep their rebuilt moves.
export function bridgeIndex(
  start: { date: string; close: number },
  days: Array<{ date: string; rows: Map<string, DayRow> }>,
  units: Map<string, number>,
  level: Map<string, number>,
  official: Map<string, number>
): Array<{ date: string; close: number; rebuilt: boolean }> {
  const last = new Map(level);
  const lr: number[] = [];
  for (const d of days) {
    lr.push(units.size > 0 ? Math.log(indexDayRatio(units, d.rows, last)) : 0);
    for (const [s, r] of d.rows) if (r[4] > 0) last.set(s, r[4]);
  }
  const out: Array<{ date: string; close: number; rebuilt: boolean }> = [];
  let anchor = start.close, i0 = 0;
  for (let i = 0; i < days.length; i++) {
    const off = official.get(days[i].date);
    if (off == null && i < days.length - 1) continue;
    let sum = 0;
    for (let k = i0; k <= i; k++) sum += lr[k];
    const shift = off != null ? (Math.log(off / anchor) - sum) / (i - i0 + 1) : 0;
    let c = anchor;
    for (let k = i0; k <= i; k++) {
      c *= Math.exp(lr[k] + shift);
      const o = official.get(days[k].date);
      out.push({ date: days[k].date, close: o ?? c, rebuilt: o == null });
    }
    anchor = off ?? c;
    i0 = i + 1;
  }
  return out;
}

export type IndexUpdate = { code: string; from: string | null; to: string | null; added: number; rebuilt: string[]; corrected?: string; note?: string };

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function updateIndexSeries(o: { pauseMs?: number } = {}): Promise<IndexUpdate[]> {
  await connectDb();
  const out: IndexUpdate[] = [];
  const docs = (await FeedSnapshotModel.find({ key: { $in: INDEX_SERIES.map((c) => `eod:bars:${c}`) } }).lean()) as any[];
  const withBars = docs.filter((d) => Array.isArray(d?.data?.bars) && d.data.bars.length > 0);
  if (withBars.length === 0) return out;
  const oldest = withBars.map((d) => d.data.bars[d.data.bars.length - 1].date as string).sort()[0];
  const sheetDocs = (await FeedSnapshotModel.find({ key: { $gte: SHEET_PREFIX + oldest, $lt: SHEET_PREFIX + "~" }, status: "ok" }).sort({ key: 1 }).lean()) as any[];
  const sheets = sheetDocs
    .map((d) => ({ date: String(d.data?.date), rows: new Map(((d.data?.rows ?? []) as DayRow[]).map((r) => [r[0], r] as [string, DayRow])) }))
    .filter((s) => s.rows.size > 0);
  const pause = () => new Promise((r) => setTimeout(r, o.pauseMs ?? 1500));
  let board: IndexBoard | null | undefined;

  for (const doc of withBars) {
    const code = String(doc.key).slice("eod:bars:".length);
    const bars = doc.data.bars as EodBar[];
    const head = bars[bars.length - 1];
    const res: IndexUpdate = { code, from: head.date, to: null, added: 0, rebuilt: [] };
    out.push(res);
    const days = sheets.filter((s) => s.date > head.date);
    if (days.length === 0) {
      res.note = "up to date";
      continue;
    }
    if (board === undefined) board = await fetchIndexBoard();
    if (!board) {
      res.note = "the index board did not load";
      continue;
    }
    const session = days[days.length - 1].date;
    const bc = boardCloses(board, code, session);
    if (!bc) {
      res.note = `the board is as of ${board.asOfDate ?? "an unknown day"}, not ${session} or the session after`;
      continue;
    }
    const official = new Map<string, number>([[session, bc.close]]);
    if (bc.prevClose != null) {
      if (days.length >= 2) official.set(days[days.length - 2].date, bc.prevClose);
      else if (Math.abs(head.close / bc.prevClose - 1) > 0.0001) {
        // The stored close before was a rebuilt one; the board now has it.
        res.corrected = `${head.date}: ${head.close} -> ${round2(bc.prevClose)}`;
        head.close = round2(bc.prevClose);
        head.vwap = head.close;
      }
    }
    await pause();
    const cons: IndexConstituent[] = await fetchIndexConstituents(code);
    const rebuildNeeded = days.some((d) => !official.has(d.date));
    if (rebuildNeeded && cons.length < 10) {
      res.note = "missed sessions, and the constituents did not load to rebuild them";
      continue;
    }
    // Free-float shares when every name has them (what reproduced the
    // official closes); otherwise units from the weights shown.
    const byFloat = cons.length > 0 && cons.every((c) => c.freeFloat > 0);
    const units = new Map(cons.map((c) => [c.symbol, byFloat ? c.freeFloat : c.weightPct / c.current] as [string, number]));
    const level = new Map(cons.map((c) => [c.symbol, c.ldcp > 0 ? c.ldcp : c.current] as [string, number]));
    const startSheet = sheets.find((s) => s.date === head.date);
    if (startSheet) for (const [s, r] of startSheet.rows) if (r[4] > 0) level.set(s, r[4]);
    const path = bridgeIndex({ date: head.date, close: head.close }, days, units, level, official);
    for (const p of path) {
      const rows = days.find((d) => d.date === p.date)!.rows;
      const volume = cons.reduce((a, c) => a + (rows.get(c.symbol)?.[5] ?? 0), 0);
      bars.push({ date: p.date, close: round2(p.close), volume, vwap: round2(p.close) });
      if (p.rebuilt) res.rebuilt.push(p.date);
    }
    res.added = path.length;
    res.to = session;
    await FeedSnapshotModel.updateOne(
      { key: doc.key },
      {
        $set: {
          data: { fetchedAt: new Date().toISOString(), bars, source: SHEET_SOURCE },
          status: "ok",
          note: `${bars.length} sessions to ${session} (dps index board${res.rebuilt.length ? `; ${res.rebuilt.join(", ")} rebuilt from constituents` : ""})`,
          updatedAt: new Date(),
        },
      }
    );
  }
  return out;
}
