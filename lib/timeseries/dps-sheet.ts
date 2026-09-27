// The exchange's end-of-day file, the one the portal's market-summary download
// serves: https://dps.psx.com.pk/download/mkt_summary/<YYYY-MM-DD>.Z, a zip
// holding closing11.lis, one line per listed name:
//
//   25SEP2026|MEBL|0807|Meezan Bank Ltd|555.0|555|545.2|548.12|418869|551.66|||
//   DATE     |SYMBOL|SECTOR|COMPANY   |OPEN |HIGH|LOW |CLOSE |VOLUME|LDCP
//
// It appears within about an hour of the close. LDCP is the exchange's own
// previous close, adjusted on bonus and split ex-dates and not for cash
// dividends, which is what lets a day from this file be appended to an
// adjusted series (lib/quant/sheet-bars.ts). The rows come out in the shape of
// the 24-year archive (psx-history.ts), so a day from here and a day from
// there are the same thing.

import { inflateRawSync } from "node:zlib";
import type { DayRow } from "./psx-history";

const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// The one file a zip holds whose name matches, or null. Reads the central
// directory, so a zip written with data descriptors reads the same.
export function unzipEntry(buf: Buffer, want: RegExp = /closing11\.lis$/i): Buffer | null {
  if (buf.length < 22) return null;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let e = 0; e < count && p + 46 <= buf.length; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("latin1");
    p += 46 + nameLen + extraLen + commentLen;
    if (!want.test(name)) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    return null;
  }
  return null;
}

// "25SEP2026" -> "2026-09-25"
export function sheetDate(s: string): string | null {
  const m = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(s.trim().toUpperCase());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2]);
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1]}`;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// Plain equities only, as the archive keeps them: futures and other contract
// lines carry a hyphen, and a name must start with a letter.
export function parseClosingSheet(text: string): { date: string | null; rows: DayRow[] } {
  const rows: DayRow[] = [];
  let date: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("|");
    if (c.length < 10) continue;
    const d = sheetDate(c[0]);
    if (!d) continue;
    date ??= d;
    if (d !== date) continue;
    const symbol = c[1].trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,11}$/.test(symbol)) continue;
    const close = num(c[7]);
    if (!(close > 0)) continue;
    rows.push([symbol, num(c[4]), num(c[5]), num(c[6]), close, num(c[8]), num(c[9])]);
  }
  return { date, rows };
}

export type SheetFetch =
  | { status: "ok"; date: string; rows: DayRow[] }
  | { status: "missing"; date: string; detail: string } // not published: a holiday, a weekend, or not yet
  | { status: "error"; date: string; detail: string };

export async function fetchClosingSheet(date: string): Promise<SheetFetch> {
  let res: Response;
  try {
    res = await fetch(`https://dps.psx.com.pk/download/mkt_summary/${date}.Z`, {
      headers: { "user-agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { status: "error", date, detail: String(e).slice(0, 120) };
  }
  if (res.status === 404) return { status: "missing", date, detail: "404" };
  if (!res.ok) return { status: "error", date, detail: `HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return { status: "missing", date, detail: "empty" };
  let text: string;
  try {
    const inner = unzipEntry(buf);
    if (!inner) return { status: "error", date, detail: `no closing11.lis in ${buf.length} bytes` };
    text = inner.toString("latin1");
  } catch (e) {
    return { status: "error", date, detail: "unzip: " + String(e).slice(0, 100) };
  }
  const sheet = parseClosingSheet(text);
  if (sheet.date !== date) return { status: "error", date, detail: `the file is for ${sheet.date ?? "no date"}` };
  if (sheet.rows.length < 100) return { status: "error", date, detail: `only ${sheet.rows.length} rows` };
  return { status: "ok", date, rows: sheet.rows };
}
