// The exchange's company-announcements board, read the way the page reads it.
//
// dps.psx.com.pk/announcements/companies fills its table with
//   POST https://dps.psx.com.pk/announcements
//   type=C&symbol=&query=&count=100&offset=0&date_from=&date_to=&page=annc
// which returns an HTML fragment: a header ("Showing 1 to 100 of 223639
// entries") and a table with DATE | TIME | SYMBOL | NAME | TITLE | files.
// The files cell carries an image ("View", data-images="282940-1.gif") and
// usually a PDF (/download/document/282940.pdf); a few rows have only the
// image, a few an attachment (/download/attachment/282829-1.pdf) instead.
// The number is the document id and identifies the announcement.
//
// No server imports here so scripts/test-announcements.ts can run it.

export const PORTAL = "https://dps.psx.com.pk";
export const BOARD_PAGE = `${PORTAL}/announcements/companies`;
const BOARD_URL = `${PORTAL}/announcements`;
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

export type BoardRow = {
  annId: string;
  symbol: string;
  company: string;
  title: string;
  announcedAt: Date;
  pdfPath: string; // "" when the row has only an image
  images: string[];
  dateOnly?: boolean; // read from a company page, which prints the date and no time
};

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// "Sep 18, 2026" + "10:51 AM" on the board are Pakistan time (UTC+5).
export function parseBoardDate(date: string, time: string): Date | null {
  const d = date.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (!d) return null;
  const month = MONTHS[d[1].toLowerCase()];
  if (month == null) return null;
  let hour = 0, minute = 0;
  const t = time.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (t) {
    hour = Number(t[1]) % 12;
    minute = Number(t[2]);
    if (t[3]?.toUpperCase() === "PM") hour += 12;
  }
  return new Date(Date.UTC(Number(d[3]), month, Number(d[2]), hour - 5, minute));
}

export function parseBoard(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 6) continue;
    const files = cells[5];
    const pdf = files.match(/href="(\/download\/(?:document|attachment)\/(\d+)[^"]*\.pdf)"/i);
    const images = [...files.matchAll(/data-images="([^"]+)"/g)].map((m) => `/download/image/${m[1]}`);
    const idFromImage = images[0]?.match(/\/(\d+)-\d+\.\w+$/)?.[1];
    const annId = pdf?.[2] ?? idFromImage;
    if (!annId) continue;
    const announcedAt = parseBoardDate(text(cells[0] ?? ""), text(cells[1] ?? ""));
    const symbol = text(cells[2]).toUpperCase();
    if (!announcedAt || !symbol) continue;
    out.push({ annId, symbol, company: text(cells[3]), title: text(cells[4]), announcedAt, pdfPath: pdf?.[1] ?? "", images });
  }
  return out;
}

// The same filings from a company's own page (dps.psx.com.pk/company/SYM),
// which the exchange still serves when the board refuses: its Announcements
// block holds three tabbed tables (Financial Results, Board Meetings, Others)
// of DATE | TITLE | files, the files cell exactly as on the board, so a row
// read here carries the board's own document id and a later board read of it
// is the same row. The page prints the date only: the row is that day,
// midnight in Karachi, marked dateOnly.
export function parseCompanyAnnouncements(html: string, symbol: string): BoardRow[] {
  const start = html.indexOf('id="announcements"');
  if (start === -1) return [];
  const after = html.indexOf('class="section section--padded company"', start + 10);
  const block = html.slice(start, after === -1 ? html.length : after);
  const company = text(html.match(/class="quote__name"[^>]*>([\s\S]*?)<\//)?.[1] ?? "");
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of block.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 3) continue;
    const files = cells[2];
    const pdf = files.match(/href="(\/download\/(?:document|attachment)\/(\d+)[^"]*\.pdf)"/i);
    const images = [...files.matchAll(/data-images="([^"]+)"/g)].map((m) => `/download/image/${m[1]}`);
    const idFromImage = images[0]?.match(/\/(\d+)-\d+\.\w+$/)?.[1];
    const annId = pdf?.[2] ?? idFromImage;
    const announcedAt = parseBoardDate(text(cells[0] ?? ""), "");
    if (!annId || !announcedAt || seen.has(annId)) continue;
    seen.add(annId);
    out.push({ annId, symbol: symbol.toUpperCase(), company, title: text(cells[1] ?? ""), announcedAt, pdfPath: pdf?.[1] ?? "", images, dateOnly: true });
  }
  return out;
}

// How often the exchange is asked, while the board refuses. The pages are
// read every 15 to 30 minutes in the hours filings are made (08:00 to 23:00
// in Karachi, Monday to Friday) and every one to two hours otherwise, at a
// random point in that span; two hours after a read that failed, rather
// than asking again at once. The refused board itself is asked again in five
// to seven hours, to notice when it answers, not every five minutes. Every
// request still names the app in its user agent: this keeps the load light
// and irregular, it does not pretend to be a person.
export function filingHours(now: Date): boolean {
  const p = new Date(now.getTime() + 5 * 3600_000);
  const day = p.getUTCDay();
  const h = p.getUTCHours();
  return day >= 1 && day <= 5 && h >= 8 && h < 23;
}

export function nextPagesAt(now: Date, readOk: boolean, rnd: () => number = Math.random): Date {
  const [lo, hi] = !readOk ? [120, 120] : filingHours(now) ? [15, 30] : [60, 120];
  return new Date(now.getTime() + (lo + (hi - lo) * rnd()) * 60_000);
}

export function nextBoardAt(now: Date, rnd: () => number = Math.random): Date {
  return new Date(now.getTime() + (300 + 120 * rnd()) * 60_000);
}

// The held names in a random order, so a read does not walk the same list
// the same way each time.
export function shuffled<T>(items: T[], rnd: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function parseBoardTotal(html: string): number {
  const m = html.match(/of\s+([\d,]+)\s+entries/i);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

// One page of the board, newest first; null when the portal refuses or hangs.
export async function fetchBoard(opts: { offset?: number; count?: number; symbol?: string; timeoutMs?: number } = {}): Promise<{ rows: BoardRow[]; total: number } | null> {
  const body = new URLSearchParams({ type: "C", symbol: opts.symbol ?? "", query: "", count: String(opts.count ?? 100), offset: String(opts.offset ?? 0), date_from: "", date_to: "", page: "annc" });
  try {
    const res = await fetch(BOARD_URL, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "text/html", referer: BOARD_PAGE },
      body: body.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!/announcementsTable|No\s+(records|data)|entries/i.test(html)) return null;
    return { rows: parseBoard(html), total: parseBoardTotal(html) };
  } catch {
    return null;
  }
}

export type BoardFile = { bytes: Buffer; contentType: string; ext: string };

// The announcement's file: the PDF when there is one, else the notice image.
export async function fetchBoardFile(path: string, timeoutMs = 90_000): Promise<BoardFile | null> {
  if (!path.startsWith("/download/")) return null;
  try {
    const res = await fetch(PORTAL + path, { headers: { "user-agent": UA, referer: BOARD_PAGE }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100) return null;
    const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    const ext = isPdf ? "pdf" : path.split(".").pop()?.toLowerCase() || "bin";
    if (path.endsWith(".pdf") && !isPdf) return null; // an error page in place of the document
    const contentType = isPdf ? "application/pdf" : ext === "gif" ? "image/gif" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
    return { bytes, contentType, ext };
  } catch {
    return null;
  }
}

export const fileUrl = (path: string) => (path ? PORTAL + path : "");
export const companyUrl = (symbol: string) => `${PORTAL}/company/${encodeURIComponent(symbol)}`;

// "18 Sep 2026, 10:51 AM PKT"; "18 Sep 2026" for a row with no time.
export function fmtPkt(d: Date, dateOnly = false): string {
  const p = new Date(d.getTime() + 5 * 3600_000);
  const day = p.getUTCDate();
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p.getUTCMonth()];
  if (dateOnly) return `${day} ${mon} ${p.getUTCFullYear()}`;
  let h = p.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${day} ${mon} ${p.getUTCFullYear()}, ${h}:${String(p.getUTCMinutes()).padStart(2, "0")} ${ap} PKT`;
}

// "MARI 2026-09-09 Material Information.pdf": the symbol and date first so the
// files sort in a chat or a mail folder.
export function fileNameFor(row: Pick<BoardRow, "symbol" | "title" | "announcedAt">, ext: string): string {
  const day = new Date(row.announcedAt.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  const title = row.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${row.symbol} ${day}${title ? " " + title : ""}.${ext}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The Telegram caption (HTML, the Bot API allows 1024 characters) and the
// plain message used when the file itself cannot be sent.
export function telegramText(row: BoardRow, withFileNote = false): string {
  const doc = row.pdfPath || row.images[0] || "";
  const lines = [
    `📢 <b>${esc(row.symbol)}</b> · ${esc(row.company)}`,
    `<b>${esc(row.title)}</b>`,
    fmtPkt(row.announcedAt, row.dateOnly),
    [doc ? `<a href="${fileUrl(doc)}">${row.pdfPath ? "Open the PDF" : "Open the notice"}</a>` : "", `<a href="${companyUrl(row.symbol)}">Company page</a>`, `<a href="${BOARD_PAGE}">All announcements</a>`].filter(Boolean).join(" · "),
  ];
  if (withFileNote) lines.push("", "The file could not be attached; the link above opens it on the exchange.");
  return lines.join("\n").slice(0, 1024);
}

// What an announcement is about, read from its title. The board's titles are
// free text, so this is a best effort on the words companies actually use:
//   "Board Meeting", "BOARD MEETING AND CLOSED PERIOD", "Board Meeting Other
//   Than Financial Results" -> board
//   "Financial Results for the Year Ended June 30, 2026", "Transmission of
//   Annual Financial Statements" -> results
//   "Credit of Interim Cash Dividend Q2 2026", "Bonus Issue" -> payout
//   "Notice of 42nd Annual General Meeting" -> agm
//   "Material Information", "Disclosure of Material Information" -> material
//   a director's interest, a public notice, a briefing recording -> other
export type AnnouncementKind = "board" | "results" | "payout" | "agm" | "material" | "other";

export function classifyAnnouncement(title: string): AnnouncementKind {
  const t = String(title ?? "").toLowerCase();
  if (/board\s*meeting|board\s*of\s*directors[^.]*meeting|closed\s*period/.test(t)) return "board";
  if (/dividend|bonus\s*(issue|shares)|right\s*(issue|shares)|book\s*clos|entitlement|payout/.test(t)) return "payout";
  if (/financial\s*(results|statements|accounts)|quarterly\s*(report|accounts)|half[\s-]*year|annual\s*(report|accounts)|transmission of/.test(t)) return "results";
  if (/annual\s*general\s*meeting|extraordinary\s*general|\beogm\b|\bagm\b/.test(t)) return "agm";
  if (/material\s*information/.test(t)) return "material";
  return "other";
}

// How much of the board a channel carries.
//   off  nothing
//   board  board meetings only
//   key  board meetings, results, payouts, general meetings, material information
//   all  everything the companies post
export type AnnounceLevel = "off" | "board" | "key" | "all";

export function announcementPasses(kind: AnnouncementKind, level: AnnounceLevel): boolean {
  if (level === "off") return false;
  if (level === "all") return true;
  if (level === "board") return kind === "board";
  return kind !== "other";
}

export const LEVEL_LABEL: Record<AnnounceLevel, string> = {
  off: "nothing",
  board: "board meetings only",
  key: "board meetings, results, payouts and notices",
  all: "everything posted",
};

export function emailSubject(row: BoardRow): string {
  return `${row.symbol}: ${row.title}`.slice(0, 180);
}

export function emailHtml(row: BoardRow, opts: { attached: boolean; appOrigin: string }): string {
  const doc = row.pdfPath || row.images[0] || "";
  return `<div style="font-family:'IBM Plex Sans',Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;color:#0f172a">
  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Company announcement</div>
  <h2 style="margin:0 0 4px;font-size:20px"><span style="color:#16a34a">${esc(row.symbol)}</span> · ${esc(row.company)}</h2>
  <div style="font-size:16px;font-weight:600;margin:10px 0 6px">${esc(row.title)}</div>
  <div style="font-size:13px;color:#6b7280">${esc(fmtPkt(row.announcedAt, row.dateOnly))}</div>
  <div style="margin:18px 0">
    ${doc ? `<a href="${fileUrl(doc)}" style="background:#0f172a;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;font-size:14px">${row.pdfPath ? "Open the PDF" : "Open the notice"}</a>` : ""}
    <a href="${companyUrl(row.symbol)}" style="margin-left:14px;color:#0f172a;font-size:14px">Company page</a>
  </div>
  ${opts.attached ? `<p style="font-size:13px;color:#6b7280">The document is attached.</p>` : doc ? `<p style="font-size:13px;color:#6b7280">The document was too large to attach; the button opens it on the exchange.</p>` : ""}
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:20px">Sent by PSX Portfolio because ${esc(row.symbol)} is in your portfolio. Turn this off under <a href="${opts.appOrigin}/settings" style="color:#6b7280">Settings</a>.</p>
</div>`;
}
