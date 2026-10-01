// Equity and total assets, read from the reports companies file on DPS.
//
// The portal's company page carries sales, profit and EPS but no balance
// sheet, and ROE, price-to-book and the DuPont split all need one. The
// quarterly, half-yearly and annual reports the companies file there do carry
// it, as a statement of financial position. Most are digital documents whose
// text can be read; some are scans with no text, and for those nothing is
// read and nothing is guessed (the holding's own book-value field stands in).
//
// The pages are rebuilt as visual lines (lib/pdf/pos-text.ts). The statement
// is the page whose heading names a statement of financial position "as at" a
// date and that carries a total-assets line; the standalone (unconsolidated)
// statement is preferred, because the EPS the portal reports is the
// standalone one. Equity is read, in order of preference, from:
//
//   1. a total-equity line: TOTAL EQUITY, total shareholders' equity, or a
//      bank's NET ASSETS, on the statement page or the facing one (the
//      equity half of a two-page statement often sits on the other page);
//   2. total equity and liabilities (or total assets) less total liabilities;
//   3. the statement of changes in equity: its closing balance on the
//      statement's date, the total column being the last.
//
// The unit is the statement's own ("Rupees", "Rupees in '000", "in
// million"), and every figure is kept in rupees with the method that read it.

import { extractLines } from "@/lib/pdf/pos-text";

export type BalanceSheet = {
  periodEnd: string; // ISO date of the statement
  equity: number; // rupees
  totalAssets: number; // rupees
  consolidated: boolean;
  method: "equity-line" | "assets-less-liabilities" | "changes-in-equity" | "owners-equity";
  unit: 1 | 1000 | 1000000;
  page: number;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// "As at 31 March 2026", "AS AT JUNE 30, 2026", "As at 31st March 2026", "as at 30.06.2026"
export function statementDate(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  let m = /as at\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})/i.exec(t);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /as at\s+([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(t);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].slice(0, 3).toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /as at\s+(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// The statement's unit, from its own heading lines.
export function statementUnit(lines: string[]): 1 | 1000 | 1000000 {
  const t = lines.join(" ").toLowerCase();
  if (/in million|\bmillions?\)|rs\.?\s*(in\s*)?m(n|illion)\b|rupees in mn|pkr\s*(in\s*)?m(n|illion)/.test(t)) return 1000000;
  // A thousands marker only in its own forms ('000, in thousand, Rupees in
  // 000, Rs. '000s): a bare "000)" also closes ordinary amounts such as
  // "(2025: 168,000,000)".
  if (/['‘’`]\s*000s?\b|\bin thousands?\b|rupees in 000s?\b|rupees 000s?\b|rs\.?\s*000s?\b|pkr\s*000s?\b|\(\s*000s?\s*\)/.test(t)) return 1000;
  return 1;
}

// The amounts on a line after its label: "67,800,921,654", "(1,234)" as
// negative; a note reference (a small number before the amounts) is dropped.
export function amountsOf(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|\(?-?\d{4,}(?:\.\d+)?\)?/g)) {
    const raw = m[0];
    const neg = raw.startsWith("(") && raw.endsWith(")");
    const v = Number(raw.replace(/[(),]/g, ""));
    if (Number.isFinite(v)) out.push(neg ? -v : v);
  }
  return out;
}

const HEAD_LINES = 14;
const isStatementHead = (lines: string[]) => {
  const head = lines.slice(0, HEAD_LINES).join(" ");
  return /statement of financial position|balance sheet/i.test(head) && !/^\s*notes? to/i.test(head) && !/we have reviewed|auditor/i.test(head) && /\bas at\b/i.test(lines.slice(0, HEAD_LINES + 6).join(" "));
};
const isConsolidated = (lines: string[]) => {
  const head = lines.slice(0, HEAD_LINES).join(" ").toLowerCase();
  return /consolidated/.test(head.replace(/un-?consolidated/g, ""));
};
const firstLine = (lines: string[], re: RegExp) => lines.find((l) => re.test(l));

const EQUITY_LINE = /^(total equity|total shareholders['‘’]? equity|shareholders['‘’]? equity|net assets)\b(?!\s*(and|&)\s*liabilities)(?!\s*attributable)/i;
const ASSETS_LINE = /^total assets\b/i;
const TEL_LINE = /^total equity\s*(and|&)\s*liabilities\b/i;
const LIAB_LINE = /^total liabilities\b/i;
const EQUITY_START = /^(equity and liabilities|equity & liabilities|share capital and reserves?|capital and reserves|equity)\b/i;
// A group's equity that belongs to the parent's shareholders, without the
// non-controlling interests: the base its EPS is struck on.
const OWNERS_LINE = /attributable to (the )?(owners|equity holders|shareholders|members)\b/i;
const LIAB_START = /^(non[- ]?current liabilities|liabilities)\b/i;

// A line that is only amounts: an unlabelled subtotal.
const numbersOnly = (l: string) => /^[\s\d,.()\-–]+$/.test(l) && amountsOf(l).length >= 1;

// The unlabelled subtotal that closes a section: the last numbers-only line
// between the section's heading and the next section's heading.
function sectionSubtotal(lines: string[], startRe: RegExp, endRe: RegExp): number | undefined {
  const s0 = lines.findIndex((l) => startRe.test(l.trim()));
  if (s0 < 0) return undefined;
  const e0 = lines.findIndex((l, i) => i > s0 && endRe.test(l.trim()));
  if (e0 < 0) return undefined;
  for (let k = e0 - 1; k > s0; k--) {
    if (numbersOnly(lines[k])) return amountsOf(lines[k])[0];
    if (/[a-z]{4}/i.test(lines[k])) return undefined; // a labelled line: no subtotal here
  }
  return undefined;
}

// One report's statement, or null when none can be read with confidence.
// The unit a statement's share capital implies: the paid-up capital is the
// shares in issue at their face value, so the ratio of the two is the unit
// (to the nearest power of a thousand, which a face value of 5 rather than
// 10 does not move). null when no clean capital line, no share count, or a
// ratio that is no power of a thousand (the heading decides then).
// The label, an optional note number, then nothing but amounts: a line that
// runs on into another column's words is two lines merged, not the capital.
const CAPITAL_LINE = /^(?:issued,? subscribed and paid[- ]?up(?: share)?(?: capital)?|share capital|paid[- ]?up capital)\s+(?:\d{1,2}(?:\.\d+)*\s+)?([\d,().\s-]+)$/i;
export function unitFromCapital(pages: string[][], shares: number | null | undefined, faceValue = 10): 1 | 1000 | 1000000 | null {
  if (!shares || shares <= 0) return null;
  for (const ls of pages) {
    for (const l of ls ?? []) {
      const m = CAPITAL_LINE.exec(l.trim());
      if (!m) continue;
      const v = amountsOf(m[1]).find((x) => x > 0);
      if (!v) continue;
      const lg = Math.log10((shares * faceValue) / v);
      const k = Math.round(lg / 3);
      if (k >= 0 && k <= 2 && Math.abs(lg - 3 * k) < 0.5) return [1, 1000, 1000000][k] as 1 | 1000 | 1000000;
    }
  }
  return null;
}

export function parseBalanceSheet(pages: string[][], ref?: { shares?: number | null; faceValue?: number | null }): BalanceSheet | null {
  const found: BalanceSheet[] = [];
  pages.forEach((lines, i) => {
    if (!lines || lines.length === 0 || !isStatementHead(lines)) return;
    const near = [lines, pages[i + 1] ?? [], pages[i - 1] ?? []];
    const all = near.flat();
    const amt = (l: string | undefined, re: RegExp) => (l ? amountsOf(l.replace(re, ""))[0] : undefined);
    // The statement's own total: total assets, equity and liabilities, or a
    // bank's unlabelled assets subtotal.
    const assetsAmt = amt(firstLine(lines, ASSETS_LINE), ASSETS_LINE) ?? amt(firstLine(lines, TEL_LINE), TEL_LINE) ?? sectionSubtotal(lines, /^assets$/i, /^liabilities\b/i);
    if (!(assetsAmt && assetsAmt > 0)) return;
    // The unit: from the share capital when the share count is known (a
    // statement may print no unit, or print it on the facing page only),
    // else from the statement's own heading.
    const unit = unitFromCapital(near, ref?.shares, ref?.faceValue ?? 10) ?? statementUnit(lines.slice(0, 30));
    const date = statementDate(lines.slice(0, HEAD_LINES + 6).join(" "));
    if (!date) return;
    let equity: number | undefined;
    let method: BalanceSheet["method"] = "equity-line";
    // 1. A total-equity line on this page or the facing one.
    for (const ls of near) {
      const v = amt(firstLine(ls, EQUITY_LINE), EQUITY_LINE);
      if (v != null && v > 0) { equity = v; break; }
    }
    // 2. The unlabelled subtotal closing the share capital and reserves.
    if (equity == null) {
      for (const ls of near) {
        const v = sectionSubtotal(ls, EQUITY_START, LIAB_START);
        if (v != null && v > 0) { equity = v; method = "equity-line"; break; }
      }
    }
    // 3. Equity and liabilities (or assets) less liabilities.
    if (equity == null) {
      const L = amt(firstLine(all, LIAB_LINE), LIAB_LINE);
      const T = amt(firstLine(all, TEL_LINE), TEL_LINE) ?? assetsAmt;
      if (L != null && T != null && T > L && L > 0) { equity = T - L; method = "assets-less-liabilities"; }
    }
    // 4. The statement of changes in equity: the closing balance on the date,
    //    whose total column is the line's largest figure.
    if (equity == null) {
      const d = new Date(date + "T00:00:00Z");
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const forms = [`${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`, `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`];
      for (const ls of pages.slice(i + 1, i + 5)) {
        const l = (ls ?? []).find((x) => /^balance as at/i.test(x) && forms.some((fm) => x.toLowerCase().includes(fm)));
        const vals = l ? amountsOf(l.replace(/^balance as at[^0-9]*\d{4}[^0-9(]*/i, "")) : [];
        const v = vals.length ? Math.max(...vals) : undefined;
        if (v != null && v > 0 && v <= assetsAmt) { equity = v; method = "changes-in-equity"; break; }
      }
    }
    // Equity above the assets, or under half a percent of them (a bank runs
    // at five or more), is a misread line, not a balance sheet.
    if (equity == null || !(equity > 0) || equity > assetsAmt * 1.0001 || equity < assetsAmt * 0.005) return;
    // A group statement: the owners' share, where it is shown. Only on the
    // statement's own pages: the profit statement beside it has an
    // "attributable to owners" line too, for the year's profit.
    if (isConsolidated(lines)) {
      const own2 = [lines, ...[pages[i + 1], pages[i - 1]].filter((p) => p && p.length && isStatementHead(p))];
      for (const ls of own2) {
        const k = ls.findIndex((x) => OWNERS_LINE.test(x) && !/profit|loss|income/i.test(x));
        if (k < 0) continue;
        const own = amountsOf(ls[k])[0] ?? (numbersOnly(ls[k + 1] ?? "") ? amountsOf(ls[k + 1])[0] : undefined);
        if (own != null && own > 0 && own <= equity) { equity = own; method = "owners-equity"; break; }
      }
    }
    found.push({ periodEnd: date, equity: equity * unit, totalAssets: assetsAmt * unit, consolidated: isConsolidated(lines), method, unit, page: i + 1 });
  });
  if (found.length === 0) return null;
  // The standalone statement when there is one; the first otherwise.
  return found.find((f) => !f.consolidated) ?? found[0];
}

export type FiledReport = { title: string; pdfUrl: string; date: string };

// A filed report or set of accounts, in the titles companies give them:
// "Transmission of Quarterly Report", "... of Half Yearly Financial Statements".
export const FILED_REPORT = /transmission of (the )?(annual|quarterly|half[- ]?yearly|interim|condensed interim)\s+(report|financial statements|accounts)/i;

// Reads the newest report on the company's page that yields a statement:
// interim and annual reports alike, newest first, at most `tries` documents.
export async function fetchBalanceSheet(reports: FiledReport[], tries = 3, ref?: { shares?: number | null; faceValue?: number | null }): Promise<(BalanceSheet & { source: string; reportTitle: string }) | null> {
  const picks = reports.filter((r) => FILED_REPORT.test(r.title)).slice(0, tries);
  for (const r of picks) {
    try {
      const res = await fetch(r.pdfUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; psx-tracker/0.1)" }, cache: "no-store", signal: AbortSignal.timeout(60000) });
      if (!res.ok) continue;
      const pages = await extractLines(new Uint8Array(await res.arrayBuffer()));
      const bs = parseBalanceSheet(pages, ref);
      if (bs) return { ...bs, source: r.pdfUrl, reportTitle: r.title };
    } catch {
      /* the next report */
    }
  }
  return null;
}
