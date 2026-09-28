// The exchange's index pages, which still answer the server now that its
// index time series does not (lib/timeseries/psx-eod.ts):
//
//   /indices         every index's high, low, current level and change, and
//                    the time the board is as of (Karachi time);
//   /indices/CODE    the index's constituents: price, previous close, change,
//                    weight, volume, free float and market cap.
//
// The board gives two official closes when it is read: the current level,
// and the previous session's close, which is the level less its change.
// lib/quant/index-bars.ts keeps the stored index series current from them,
// and rebuilds any session it missed from the constituents.

const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type IndexBoardRow = { code: string; high: number; low: number; current: number; change: number; changePct: number };
export type IndexBoard = { asOfDate: string | null; asOfMinutes: number | null; rows: Map<string, IndexBoardRow> };
export type IndexConstituent = { symbol: string; ldcp: number; current: number; change: number; weightPct: number; volume: number; freeFloat: number; marketCap: number };

const num = (s: string | null | undefined) => {
  const n = Number(String(s ?? "").replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

type Cell = { order: string | null; text: string };
const cellsOf = (tr: string): Cell[] =>
  [...tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({
    order: /data-order="([^"]*)"/.exec(m[1])?.[1] ?? null,
    text: m[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(),
  }));
const valueOf = (c: Cell | undefined) => (c ? (c.order != null ? num(c.order) : num(c.text)) : 0);

// "As of  Sep 28, 2026 2:44 AM" -> 2026-09-28 and minutes past midnight.
export function parseAsOf(html: string): { date: string; minutes: number } | null {
  const m = /As of\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/.exec(html);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1]);
  if (mo < 0) return null;
  const h = (Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0);
  return { date: `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`, minutes: h * 60 + Number(m[5]) };
}

export function parseIndexBoard(html: string): IndexBoard {
  const rows = new Map<string, IndexBoardRow>();
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const code = /data-code="([^"]+)"/.exec(tr)?.[1];
    if (!code) continue;
    const c = cellsOf(tr);
    if (c.length < 6) continue;
    const current = valueOf(c[3]);
    if (!(current > 0)) continue;
    rows.set(code, { code, high: valueOf(c[1]), low: valueOf(c[2]), current, change: valueOf(c[4]), changePct: valueOf(c[5]) });
  }
  const asOf = parseAsOf(html);
  return { asOfDate: asOf?.date ?? null, asOfMinutes: asOf?.minutes ?? null, rows };
}

// Columns: SYMBOL NAME LDCP CURRENT CHANGE CHANGE% IDX-WTG% IDX-POINT VOLUME FREEFLOAT MARKET-CAP.
export function parseIndexConstituents(html: string): IndexConstituent[] {
  const out: IndexConstituent[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const c = cellsOf(tr);
    if (c.length < 11 || !c[0].order || !/^[A-Z][A-Z0-9]{1,11}$/.test(c[0].order)) continue;
    const current = valueOf(c[3]);
    if (!(current > 0)) continue;
    out.push({
      symbol: c[0].order,
      ldcp: valueOf(c[2]),
      current,
      change: valueOf(c[4]),
      weightPct: num(c[6].text),
      volume: valueOf(c[8]),
      freeFloat: valueOf(c[9]),
      marketCap: valueOf(c[10]),
    });
  }
  return out;
}

async function page(path: string): Promise<string | null> {
  try {
    const res = await fetch(`https://dps.psx.com.pk${path}`, { headers: { "user-agent": UA }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function fetchIndexBoard(): Promise<IndexBoard | null> {
  const html = await page("/indices");
  if (!html) return null;
  const b = parseIndexBoard(html);
  return b.rows.size > 0 ? b : null;
}

export async function fetchIndexConstituents(code: string): Promise<IndexConstituent[]> {
  const html = await page(`/indices/${encodeURIComponent(code)}`);
  return html ? parseIndexConstituents(html) : [];
}
