// A contract-note parser for the brokers we have no sample of.
//
// The BMA parser in bma-note.ts knows that layout exactly and reconciles it to
// the paisa. Every other PSX broker sends a different sheet, and writing a
// parser per house without a single sample of it would be inventing regular
// expressions and hoping. So this one does not try to know the layout. It
// looks for the ARITHMETIC that every contract note in the market must contain:
// somewhere on the page there are rows where a quantity times a rate equals an
// amount, and those amounts add up to a stated total.
//
// That is the whole idea, and it is also the safety rail. A row is only a trade
// if its own numbers multiply out. A note only produces import rows if the rows
// add up to the total printed on it. Anything else comes back with the raw
// lines attached and imports nothing, which is the same contract the BMA parser
// honours: a layout surprise fails loudly rather than importing a wrong number.
//
// What it deliberately does NOT do:
//   - guess a symbol that is not on the page
//   - accept a note whose rows do not sum to its own total
//   - invent a commission when the note does not state one
//   - infer a side from anything other than the words on the page
//
// It will not read every broker in Pakistan. It reads the ones whose notes are
// arithmetically honest, which is most of them, and it says so plainly when it
// cannot.

export type GenericRow = {
  symbol: string;
  qty: number;
  rate: number; // the rate the amount was computed at
  amount: number; // qty x rate, as printed
  line: string; // the source line, so a person can check it
};

export type GenericNote = {
  broker: string; // best guess from the letterhead, "" when unknown
  side: "BUY" | "SELL" | null;
  tradeDate: string; // ISO, "" when not found
  rows: GenericRow[];
  rowSum: number;
  statedTotal: number | null; // the note's own total, when it prints one
  fees: number; // total minus the rows, when both are known
  problems: string[]; // non-empty = do NOT import
  rawLines: string[]; // always returned, so a refusal can be inspected
};

const NUM_RE = /-?[\d,]+(?:\.\d+)?/g;

const num = (s: string): number => Number(s.replace(/,/g, ""));
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// Tokens that look like symbols but are not. PSX symbols are short and upper
// case, which is also true of half the words on a letterhead.
const NOT_A_SYMBOL = new Set([
  "TOTAL", "GRAND", "SUB", "NET", "QTY", "RATE", "AMOUNT", "VALUE", "PRICE", "SST", "CDC", "CVT",
  "WHT", "TAX", "COMM", "COMMISSION", "BUY", "SELL", "PURCHASE", "SALE", "BOUGHT", "SOLD", "DATE",
  "NAME", "CLIENT", "ACCOUNT", "NO", "REF", "PKR", "RS", "LTD", "PVT", "SECURITIES", "BROKER",
  "CONTRACT", "NOTE", "SETTLEMENT", "TRADE", "SCRIP", "SYMBOL", "COMPANY", "MARKET", "PAGE",
  "TERMS", "NCCPL", "PSX", "LIMITED", "INVOICE", "BILL", "SUMMARY", "DESCRIPTION", "PARTICULARS",
  "OF", "AND", "THE", "FOR", "PER", "TO", "IN", "ON", "AT", "BY",
]);

const SYMBOL_RE = /^[A-Z][A-Z0-9&.-]{1,11}$/;

// "30/07/2026", "30-07-2026", "2026-07-30", "30-Jul-2026" all become ISO.
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function findDate(text: string): string {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = /\b(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/](20\d{2})\b/.exec(text);
  if (named) {
    const mm = MONTHS[named[2].toLowerCase()];
    if (mm) return `${named[3]}-${mm}-${named[1].padStart(2, "0")}`;
  }

  // Ambiguous numeric. Pakistan writes dd/mm/yyyy, so that is the reading —
  // except where the first field is above 12, which settles it either way.
  const dmy = /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/.exec(text);
  if (dmy) {
    let d = Number(dmy[1]);
    let m = Number(dmy[2]);
    if (d <= 12 && m > 12) [d, m] = [m, d]; // clearly mm/dd, flip it
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${dmy[3]}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return "";
}

function detectSide(text: string): "BUY" | "SELL" | null {
  const buy = /\b(purchase|bought|buy)\b/i.test(text);
  const sell = /\b(sale|sold|sell)\b/i.test(text);
  if (buy && !sell) return "BUY";
  if (sell && !buy) return "SELL";
  return null; // both words present, or neither: the caller must be told
}

function detectBroker(lines: string[]): string {
  // The house name is on the first few lines, and it is the line containing a
  // corporate suffix. Good enough to label an import; nothing depends on it.
  for (const line of lines.slice(0, 8)) {
    if (/\b(securities|capital|brokerage|investments?)\b/i.test(line) && line.length < 70) {
      return line.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

// The heart of it: does this line contain a quantity, a rate and an amount that
// actually multiply out? Every plausible triple is tried, and the one using the
// largest number as the amount wins, because on a contract-note row the money
// is the biggest figure on the line.
function readRow(line: string): Omit<GenericRow, "symbol"> | null {
  const raw = line.match(NUM_RE);
  if (!raw || raw.length < 3) return null;
  const nums = raw.map(num).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length < 3) return null;

  let best: { qty: number; rate: number; amount: number } | null = null;
  for (let a = 0; a < nums.length; a++) {
    const amount = nums[a];
    if (amount < 100) continue; // a trade of under a hundred rupees is not a trade
    for (let q = 0; q < nums.length; q++) {
      if (q === a) continue;
      const qty = nums[q];
      // Whole shares only. PSX does not trade fractions, so a non-integer here
      // is some other column that happens to divide neatly.
      if (!Number.isInteger(qty) || qty < 1) continue;
      for (let r = 0; r < nums.length; r++) {
        if (r === a || r === q) continue;
        const rate = nums[r];
        if (rate <= 0 || rate > amount) continue;
        // A paisa of rounding per row is normal; more is a coincidence rather
        // than a calculation.
        if (!close(qty * rate, amount, Math.max(0.05, amount * 0.0001))) continue;
        if (!best || amount > best.amount) best = { qty, rate, amount };
      }
    }
  }
  return best ? { ...best, line: line.trim() } : null;
}

function readSymbol(line: string): string {
  for (const tok of line.split(/[\s|,]+/)) {
    const t = tok.replace(/[^A-Z0-9&.-]/gi, "").toUpperCase();
    if (!SYMBOL_RE.test(t)) continue;
    if (NOT_A_SYMBOL.has(t)) continue;
    if (/^\d+$/.test(t)) continue; // a bare number is not a symbol
    return t;
  }
  return "";
}

export function parseGenericNote(pages: string[][]): GenericNote {
  const lines = pages.flat();
  const joined = lines.join("\n");
  const problems: string[] = [];

  const side = detectSide(joined);
  if (!side) {
    problems.push(
      "Could not tell a purchase from a sale on this note. Both words appear, or neither does — set the side by hand rather than letting a guess decide which way your position moved."
    );
  }

  const tradeDate = findDate(joined);
  if (!tradeDate) problems.push("No trade date found on the note.");

  // Rows, skipping any line that reads as a total: those numbers reconcile too,
  // and counting a total as a trade would double the note.
  const rows: GenericRow[] = [];
  for (const line of lines) {
    if (/\b(total|balance|carried|brought forward)\b/i.test(line)) continue;
    const t = readRow(line);
    if (!t) continue;
    const symbol = readSymbol(line);
    if (!symbol) {
      problems.push(`A row of numbers reconciles but carries no readable symbol: "${line.trim().slice(0, 80)}"`);
      continue;
    }
    rows.push({ symbol, ...t });
  }

  if (rows.length === 0) {
    problems.push(
      "No trade rows recognised. A row is only accepted when its own quantity times its rate equals its amount, and nothing on this note does that — the numbers may be laid out in a way flat text extraction has scrambled."
    );
  }

  const rowSum = rows.reduce((s, r) => s + r.amount, 0);

  // The note's own total. The largest number on any line that says "total" is
  // the grand total, since a note commonly prints a sub-total beside it.
  let statedTotal: number | null = null;
  for (const line of lines) {
    if (!/\btotal\b/i.test(line)) continue;
    const found = (line.match(NUM_RE) ?? []).map(num).filter((n) => Number.isFinite(n) && n > 0);
    for (const n of found) if (statedTotal == null || n > statedTotal) statedTotal = n;
  }

  let fees = 0;
  if (statedTotal != null && rows.length > 0) {
    const gap = Math.abs(statedTotal - rowSum);
    // The difference between the rows and the total is the charges. A gap of
    // more than 5% is not a commission, it is a misread, and it is refused.
    if (gap > rowSum * 0.05) {
      problems.push(
        `The rows add to ${rowSum.toFixed(2)} but the note's total is ${statedTotal.toFixed(2)}. A gap that size is not commission and tax, so a row has been read wrongly or missed. Nothing is imported.`
      );
    } else {
      fees = Math.round(gap * 100) / 100;
    }
  } else if (rows.length > 0) {
    problems.push(
      "The note prints no total to check the rows against, so the figures cannot be proven. Read them against the note before importing."
    );
  }

  return {
    broker: detectBroker(lines),
    side,
    tradeDate,
    rows,
    rowSum,
    statedTotal,
    fees,
    problems,
    rawLines: lines,
  };
}

export type GenericImportRow = {
  symbol: string;
  type: "BUY" | "SELL";
  date: string;
  shares: number;
  price: number;
  fees: number;
  notes: string;
};

// Note to import rows. Refuses outright when anything failed to reconcile, and
// splits the charges across rows in proportion to what each one cost, which is
// the only split that does not need to know each broker's fee schedule.
export function genericToImportRows(note: GenericNote): GenericImportRow[] {
  if (note.problems.length > 0 || !note.side || !note.tradeDate) return [];

  const merged = new Map<string, { symbol: string; qty: number; amount: number }>();
  for (const r of note.rows) {
    const key = `${r.symbol}@${r.rate}`;
    const m = merged.get(key) ?? { symbol: r.symbol, qty: 0, amount: 0 };
    m.qty += r.qty;
    m.amount += r.amount;
    merged.set(key, m);
  }

  const label = note.broker ? note.broker.split(/\s+/).slice(0, 3).join(" ") : "broker";
  return [...merged.values()].map((m) => ({
    symbol: m.symbol,
    type: note.side as "BUY" | "SELL",
    date: note.tradeDate,
    shares: m.qty,
    price: m.qty > 0 ? Math.round((m.amount / m.qty) * 10000) / 10000 : 0,
    fees: note.rowSum > 0 ? Math.round(((note.fees * m.amount) / note.rowSum) * 100) / 100 : 0,
    notes: `${label} note ${note.tradeDate} (parsed generically, charges split by value)`,
  }));
}
