// Dividends read from the company's own letter to the exchange: the results
// announcement (Form-3) says the cash dividend, as a % of the face value and
// rupees a share, and usually the book closure; a notice of the general
// meeting may give the book closure alone. The exchange's payout list
// refuses automated requests, so this is where the dates come from. Works on
// a PDF's text or on what OCR read from a scanned one. Pure, so
// scripts/test-payout-letter.ts runs it.

export type LetterPayout = {
  nil: boolean; // the letter says no cash dividend
  cycle: "F" | "i" | "ii" | "iii" | "";
  pctOfFace: number | null;
  rsPerShare: number | null;
  faceValue: number | null; // when the letter gives both the % and the rupees
  bookClosure: string | null; // yyyy-mm-dd, the first day the books are closed
  bookClosureEnd: string | null;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const FULL_DATE = `\\d{1,2}\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+\\d{4}|${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}`;
// The first date of a range may leave the year to the second: "from October 21 to October 28, 2026".
const START = `(${FULL_DATE}|\\d{1,2}\\s+(?:of\\s+)?${MONTH}|${MONTH}\\.?\\s+\\d{1,2})`;
const END = `(${FULL_DATE})`;
// "from Wednesday, 21 October 2026": the day's name before a date.
const WEEKDAY = "(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\\s+)?";
const BOOKS = new RegExp(`(?:transfer\\s+books?|book\\s+closure|register\\s+of\\s+members)[^.]{0,160}?from\\s+${WEEKDAY}${START},?\\s+(?:to|till|until|upto|up\\s+to|-|–)\\s+${WEEKDAY}${END}`, "gi");
const pad = (n: number) => String(n).padStart(2, "0");

export function normalizeLetter(raw: string): string {
  return String(raw ?? "")
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, " ")
    // A superscript ordinal comes out of OCR as "st", a quote, a % or a degree.
    .replace(new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th|['"%°º*])(?=\\s*(?:of\\s+)?${MONTH}\\b)`, "gi"), "$1")
    // A 1 in a rupee amount read as an i or an l.
    .replace(/\bR(e|s)\.?\s*[il](?=\s*[/.,-]|\s)/gi, (_m, e) => `R${e}.1`)
    .trim();
}

export function parseLetterDate(s: string): string | null {
  const t = s.trim().replace(/\.(?=\s|,)/, "");
  let m = t.match(new RegExp(`^(\\d{1,2})\\s+(?:of\\s+)?(${MONTH}),?\\s+(\\d{4})`, "i"));
  if (m) return ymd(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  m = t.match(new RegExp(`^(${MONTH})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i"));
  if (m) return ymd(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1])); // day first, as Pakistani letters write it
  return null;
}

function ymd(y: number, mo: number | undefined, d: number): string | null {
  if (!mo || mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const FACES = [1, 2, 2.5, 5, 10, 100];
const daysBetween = (from: string, to: string) => (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;

// Which letters say a dividend or its dates: the results announcement, a
// dividend or book-closure notice, a general-meeting notice. Reports, notices
// that a dividend was paid, copies of resolutions and the like repeat it or
// older ones and are left alone, as is an extraordinary meeting's.
export function isDividendLetter(title: string): boolean {
  const t = String(title ?? "");
  if (/transmission|quarterly\s+report|annual\s+report|half[\s-]*yearly\s+report|credit\s+of|payment|unclaimed|e-?dividend|briefing|disclosure|extra-?ordinary|\beogm\b|certified\s+true\s+copy|resolutions?\s+(?:passed|adopted)|addendum|change\s+of\s+venue/i.test(t)) return false;
  return /financial\s+results?|dividend|book\s+closure|entitlement|annual\s+general\s+meeting|\bagm\b|board\s+meeting/i.test(t);
}

// The books closed for a dividend or the meeting that approves it; books
// closed for an extraordinary meeting alone say nothing about a dividend.
function findBooks(text: string): { start: string; end: string } | null {
  for (const b of text.matchAll(BOOKS)) {
    const at = b.index ?? 0;
    if (/extra-?ordinary|\beogm\b/i.test(text.slice(Math.max(0, at - 200), at + b[0].length + 200))) continue;
    const end = parseLetterDate(b[2]);
    const start = parseLetterDate(b[1]) ?? (end ? parseLetterDate(`${b[1].replace(/[.,\s]+$/, "")} ${end.slice(0, 4)}`) : null);
    if (start && end) return { start, end };
  }
  return null;
}

// `announcedOn` (yyyy-mm-dd), when given, is the letter's date: books closed
// more than a few days before it or over three months after are some other
// year's, and are not taken. `rest` is the letter's later pages, read for the
// book closure only: a meeting notice puts it in its notes, while the
// statements behind a results letter repeat old dividends.
export function parsePayoutLetter(raw: string, announcedOn?: string, rest = ""): LetterPayout | null {
  const text = normalizeLetter(raw);
  const out: LetterPayout = { nil: false, cycle: "", pctOfFace: null, rsPerShare: null, faceValue: null, bookClosure: null, bookClosureEnd: null };

  // The books: "Share Transfer Books ... closed from 21 October 2026 to 28 October 2026".
  const books = findBooks(text) ?? (rest ? findBooks(normalizeLetter(rest)) : null);
  if (books && !(announcedOn && (daysBetween(announcedOn, books.start) < -5 || daysBetween(announcedOn, books.start) > 95))) {
    out.bookClosure = books.start;
    out.bookClosureEnd = books.end;
  }

  // The cash dividend: its clause up to where the letter turns to what was
  // already paid, or to bonus and right shares.
  const re = /cash\s+dividends?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    if (/already\s+paid|in\s+addition\s+to[^.]*$/.test(before)) continue;
    let clause = text.slice(m.index, m.index + 320);
    const cut = clause.search(/this\s+is\s+in\s+addition|in\s+addition\s+to|already\s+paid|\(ii\)|\bii\)|bonus\s+shares?|right\s+shares?/i);
    if (cut > 0) clause = clause.slice(0, cut);
    const nil = /^cash\s+dividends?\s*[:\-–]?\s*(?:nil|none|n\/a)\b/i.test(clause);
    const pct = clause.match(/(\d+(?:\.\d+)?)\s*%/);
    // The rupees a share, not the face value the % is of ("125% of the face
    // value of Re.1/- per share i.e. Rs.1.25").
    const amounts = [...clause.matchAll(/R[se]\.?\s*_?\s*(\d+(?:\.\d+)?)(?!\s*%)/gi)];
    const rs = amounts.find((x) => !/face\s+value\s*(?:of)?\s*$/i.test(clause.slice(Math.max(0, (x.index ?? 0) - 25), x.index))) ?? null;
    if (nil && !pct) {
      out.nil = true;
      continue;
    }
    if (!pct && !rs) continue;
    // Declared now: the board recommends, declares or approves it, or the
    // notice gives the entitlement to it. A dividend only mentioned (last
    // year's, in a note) is not one.
    const lead = text.slice(Math.max(0, m.index - 400), m.index + clause.length);
    if (!/recommend|declare|approv|announce|resolved|entitle/i.test(lead)) continue;
    const words = `${before} ${clause.slice(0, 60)}`.toLowerCase();
    out.cycle = /final/.test(words) ? "F" : /(second|2nd)\s+interim/.test(words) ? "ii" : /(third|3rd)\s+interim/.test(words) ? "iii" : /interim/.test(words) ? "i" : "";
    out.pctOfFace = pct ? Number(pct[1]) : null;
    out.rsPerShare = rs ? Number(rs[1]) : null;
    out.nil = false;
    break;
  }
  if (out.pctOfFace != null && out.rsPerShare != null && out.pctOfFace > 0) {
    const fv = out.rsPerShare / (out.pctOfFace / 100);
    out.faceValue = FACES.find((f) => Math.abs(fv / f - 1) < 0.03) ?? null;
  }
  if (out.pctOfFace == null && out.rsPerShare == null && !out.nil && !out.bookClosure) return null;
  return out;
}

// `source` is "letter" for a row read from a letter.
export type StoredPayout = { date: string | null; bookClosure: string | null; pctOfFace: number; cycle: string; payoutType: string; source?: string };

const days = (a: string, b: string) => Math.abs(daysBetween(a, b));

// A letter's dividend into the company's payout list. One the list already
// has with its dates (the same book closure, or one of the same kind, final
// or interim, closing from a month before the letter to two months after) is
// left as it is: the meeting notice and its newspaper copy repeat the results
// letter, and the exchange's own row is not overwritten by what OCR read. A
// dividend without its dates is kept pending, and a later letter with only
// the book closure (the meeting notice) completes it. `faceValue` turns
// rupees into the % of face.
export function mergeLetterPayout(payouts: StoredPayout[], r: LetterPayout, announcedOn: string, faceValue: number): StoredPayout[] {
  const list = payouts.map((p) => ({ ...p }));
  const pct = r.pctOfFace ?? (r.rsPerShare != null && faceValue > 0 ? Math.round((r.rsPerShare / faceValue) * 10000) / 100 : null);
  const sameKind = (cycle: string) => r.cycle === "" || cycle === "" || (r.cycle === "F") === (cycle === "F");
  const known = list.findIndex(
    (p) => p.payoutType === "cash" && p.bookClosure && (p.bookClosure === r.bookClosure || (sameKind(p.cycle) && daysBetween(announcedOn, p.bookClosure) >= -35 && daysBetween(announcedOn, p.bookClosure) <= 60))
  );
  const pending = list.findIndex((p) => !p.bookClosure && p.payoutType === "cash" && sameKind(p.cycle) && p.date != null && days(p.date, announcedOn) <= 75);
  if (pct != null && pct > 0) {
    if (known >= 0) {
      if (list[known].source === "letter" && list[known].bookClosure === r.bookClosure) list[known] = { ...list[known], pctOfFace: pct };
      return list;
    }
    const row = { date: announcedOn, bookClosure: r.bookClosure, pctOfFace: pct, cycle: r.cycle, payoutType: "cash", source: "letter" };
    if (pending >= 0) list[pending] = { ...row, date: list[pending].date ?? announcedOn };
    else list.push(row);
    return list;
  }
  if (r.bookClosure && known < 0 && pending >= 0) list[pending] = { ...list[pending], bookClosure: r.bookClosure };
  return list;
}

// The exchange's payout list, when it answers again, replaces the kept one,
// but a dividend read from a letter that the list does not show yet stays.
export function withLetterRows(board: StoredPayout[], kept: StoredPayout[]): StoredPayout[] {
  const shown = (p: StoredPayout) =>
    board.some((b) => b.payoutType === p.payoutType && (p.bookClosure ? b.bookClosure === p.bookClosure : b.cycle === p.cycle && b.date != null && p.date != null && days(b.date, p.date) <= 75));
  return [...board, ...kept.filter((p) => p.source === "letter" && !shown(p))];
}
