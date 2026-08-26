// Company filings scraped from the PSX data portal company page.
//
// dps.psx.com.pk/company/SYMBOL renders its "Announcements" block server-side
// as three tabbed tables — Financial Results, Board Meetings, Others — each row
// carrying a date, a title and a link to the PDF the company actually filed.
// Those PDFs are the primary source behind every number in this app, so being
// able to open the filing from the position is the point.
//
// The page ALSO has a "Financial Reports" section, but its table arrives empty
// and is filled in later by the portal's own script, so there is nothing in the
// HTML to read. It is not parsed here rather than guessed at.

const PSX_URL = (sym: string) => `https://dps.psx.com.pk/company/${encodeURIComponent(sym)}`;
const PSX_ORIGIN = "https://dps.psx.com.pk";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

export const FILING_CATEGORIES = ["Financial Results", "Board Meetings", "Others"] as const;
export type FilingCategory = (typeof FILING_CATEGORIES)[number];

export type Filing = {
  symbol: string;
  category: FilingCategory;
  date: string; // ISO yyyy-mm-dd; "" when the portal printed something unreadable
  dateLabel: string; // exactly as printed, kept so a bad parse is still visible
  title: string;
  pdfUrl: string | null; // absolute; null when the row links no document
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// "Jun 4, 2026" → "2026-06-04". Returns "" rather than a guess.
export function filingDateToIso(s: string): string {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s.trim());
  if (!m) return "";
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return "";
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pure: hand it the page HTML, get the filings back. Tested against a real
// captured page so a portal layout change fails loudly in CI rather than
// silently returning nothing.
export function parseFilings(html: string, symbol: string): Filing[] {
  const out: Filing[] = [];
  const start = html.indexOf('id="announcements"');
  if (start === -1) return out;
  // Stop at the next top-level section so a later table cannot leak in.
  const after = html.indexOf('class="section section--padded company"', start + 10);
  const block = html.slice(start, after === -1 ? html.length : after);

  const panelRe = /<div class="tabs__panel"[^>]*data-name="([^"]+)"[^>]*>([\s\S]*?)(?=<div class="tabs__panel"|$)/g;
  let panel: RegExpExecArray | null;
  while ((panel = panelRe.exec(block)) !== null) {
    const name = decode(panel[1]) as FilingCategory;
    if (!FILING_CATEGORIES.includes(name)) continue;
    const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
    let row: RegExpExecArray | null;
    while ((row = rowRe.exec(panel[2])) !== null) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      if (cells.length < 2) continue; // header rows carry <th>, not <td>
      const dateLabel = decode(cells[0]);
      const title = decode(cells[1]);
      if (!title) continue;
      const href = cells[2] ? /href="([^"]*\.pdf)"/i.exec(cells[2])?.[1] ?? null : null;
      out.push({
        symbol,
        category: name,
        date: filingDateToIso(dateLabel),
        dateLabel,
        title,
        pdfUrl: href ? (href.startsWith("http") ? href : PSX_ORIGIN + href) : null,
      });
    }
  }
  // Newest first; rows with an unreadable date sink rather than jumping the queue.
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export async function fetchFilings(symbol: string): Promise<Filing[]> {
  const res = await fetch(PSX_URL(symbol), {
    headers: { "user-agent": UA, accept: "text/html" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`PSX ${symbol}: HTTP ${res.status}`);
  return parseFilings(await res.text(), symbol.toUpperCase());
}
