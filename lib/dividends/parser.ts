// Parser for CDC "Dividend / Zakat & Tax Deduction Report" PDFs.
// These all use the same labelled-table layout — we anchor regexes on the
// stable labels so column-by-column extraction is robust.

import { extractText, getDocumentProxy } from "unpdf";

export type ParsedWarrant = {
  warrantNo: string | null;
  companyName: string | null;
  shares: number | null;
  ratePerSecurity: number | null;
  grossAmount: number | null;
  taxDeducted: number | null;
  zakatDeducted: number | null;
  amountPaid: number | null;
  paymentDate: string | null; // ISO yyyy-mm-dd
  issueDate: string | null;
  financialYear: string | null;
  dividendType: string | null;
  paymentStatus: string | null;
  raw: string;
};

function toIsoDate(dmy: string | undefined | null): string | null {
  if (!dmy) return null;
  const m = dmy.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? "20" + y : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function toNum(s: string | undefined | null): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Find the value(s) that follow a given anchor on the next line.
function tail(rgx: RegExp, text: string): string | null {
  const m = text.match(rgx);
  return m ? m[1] : null;
}

export async function parseWarrantPdf(buffer: Buffer): Promise<ParsedWarrant> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  // mergePages=true gives us one concatenated string with newlines between pages.
  const { text } = await extractText(pdf, { mergePages: true });
  const combined = Array.isArray(text) ? text.join("\n") : text;
  return parseFromText(combined);
}

export function parseFromText(text: string): ParsedWarrant {
  // unpdf returns one long line. Collapse all whitespace runs so anchor
  // labels stay intact and our regexes can be position-agnostic.
  const norm = text.replace(/\s+/g, " ").trim();

  // Company name = everything before "DIVIDEND / ZAKAT".
  const headerMatch = norm.match(/^(.+?)\s+DIVIDEND \/ ZAKAT/i);
  const companyName = headerMatch ? headerMatch[1].trim() : null;

  // Extract each field independently so one missing/reordered field doesn't
  // cascade and null out the rest. Each regex looks within a window after its
  // anchor label, not across the entire document.

  // Warrant No. (REQUIRED for dedup) — always followed by an integer.
  // Tolerate two layouts:
  //   "Warrant No. 55017726"
  //   "Warrant No. No. of Securities Securities Liable to Zakat 55017726 1 0"
  const warrantNoMatch =
    norm.match(/Warrant No\.[^\d]*?(\d+)\s+\d+\s+\d+/i) ??
    norm.match(/Warrant No\.[^\d]*?(\d+)/i);
  const warrantNo = warrantNoMatch ? warrantNoMatch[1] : null;

  // No. of Securities (shares at record date).
  const sharesMatch =
    norm.match(/No\. of Securities[^\d]*?Securities Liable to Zakat[^\d]*?\d+\s+(\d+)/i) ??
    norm.match(/No\. of Securities[^\d]*?(\d+)/i);
  const shares = sharesMatch ? toNum(sharesMatch[1]) : null;

  // Date of Issue
  const issueDateMatch = norm.match(/Date of Issue[^\d]{1,200}?(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
  const issueDate = issueDateMatch ? toIsoDate(issueDateMatch[1]) : null;

  // Financial Year — accept "2024-25", "2024-2025", "2024/25", "FY 2024-25".
  const fyMatch =
    norm.match(/Financial Year[^\d]{1,200}?(\d{4}[-/]\d{2,4})/i) ??
    norm.match(/FY\s+(\d{4}[-/]\d{2,4})/i);
  const financialYear = fyMatch ? fyMatch[1] : null;

  // Rate Per Security — currency-prefixed or bare decimal.
  const rateMatch =
    norm.match(/Rate Per Security[^]{1,200}?Rs\.?\s*([\d,]+\.?\d*)/i) ??
    norm.match(/Rate Per Security[^]{1,200}?(?<!\d)([\d,]+\.\d+)/i);
  const ratePerSecurityRaw = rateMatch ? toNum(rateMatch[1]) : null;

  // Amount of Dividend (Rs.) — gross.
  const grossMatch =
    norm.match(/Amount of Dividend[^\d]{1,80}?\d+\s+([\d,]+\.?\d*)/i) ??
    norm.match(/Amount of Dividend[^\d]{1,80}?([\d,]+\.\d+)/i);
  const grossAmount = grossMatch ? toNum(grossMatch[1]) : null;

  // Zakat Deducted and Tax Deducted. They share a header row but the values
  // can come in either order depending on layout. Anchor on each individually.
  const zakatMatch =
    norm.match(/Zakat Deducted[^]{1,120}?Tax Deducted[^]{1,40}?([\d,]+\.?\d*)\s+[\d,]+\.?\d*/i) ??
    norm.match(/Zakat Deducted[^]{1,40}?([\d,]+\.?\d*)/i);
  const taxMatch =
    norm.match(/Tax Deducted[^]{1,120}?([\d,]+\.?\d*)\s*Amount Paid/i) ??
    norm.match(/Zakat Deducted[^]{1,120}?Tax Deducted[^\d]{1,40}?[\d,]+\.?\d*\s+([\d,]+\.?\d*)/i) ??
    norm.match(/Tax Deducted[^]{1,80}?([\d,]+\.?\d*)/i);
  const zakatDeducted = zakatMatch ? toNum(zakatMatch[1]) : null;
  const taxDeducted = taxMatch ? toNum(taxMatch[1]) : null;

  // Amount Paid (Rs.) <num>
  const amountPaid = toNum(tail(/Amount Paid \(Rs\.\)\s+([\d,]+\.?\d*)/i, norm));

  // Payment Status / Payment Date — also extract independently.
  const paymentDateMatch = norm.match(/Payment Date[^]{0,60}?(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
  const paymentDate = paymentDateMatch ? toIsoDate(paymentDateMatch[1]) : null;
  const paymentStatusMatch = norm.match(/Payment Status[^]{0,60}?\b(PAID|Paid|UNPAID|Unpaid|Pending|Held)\b/);
  const paymentStatus = paymentStatusMatch ? paymentStatusMatch[1] : null;

  // Dividend type from the disclosure prose.
  const typeMatch = norm.match(/details of the (\w+) dividend disbursed/i);
  const dividendType = typeMatch ? typeMatch[1] : null;

  // Fallback: derive rate from gross / shares if the rate field was missing
  // or zero. Common for warrants where the rate has 4 decimals and the
  // explicit Rs. prefix is replaced by a column alignment.
  let ratePerSecurity = ratePerSecurityRaw;
  if ((ratePerSecurity == null || ratePerSecurity === 0) && grossAmount && shares && shares > 0) {
    ratePerSecurity = Math.round((grossAmount / shares) * 10000) / 10000;
  }

  return {
    warrantNo,
    companyName,
    shares,
    ratePerSecurity,
    grossAmount,
    taxDeducted,
    zakatDeducted,
    amountPaid,
    paymentDate,
    issueDate,
    financialYear,
    dividendType,
    paymentStatus,
    raw: text,
  };
}

// Compact "good enough" mapping from a company name to a likely PSX symbol.
// The UI always lets the user override, so this is only a starting hint.
// Strategy: search existing user holdings for a name substring match.
export function suggestSymbol(
  companyName: string | null,
  existingHoldings: Array<{ symbol: string; name: string }>
): string | null {
  if (!companyName) return null;
  const lower = companyName.toLowerCase();
  // Prefer holdings whose name shares the longest run of words.
  let best: { symbol: string; score: number } | null = null;
  for (const h of existingHoldings) {
    const hn = h.name.toLowerCase();
    let score = 0;
    for (const word of hn.split(/[^a-z]+/).filter((w) => w.length > 3)) {
      if (lower.includes(word)) score += word.length;
    }
    if (!best || score > best.score) best = { symbol: h.symbol, score };
  }
  return best && best.score >= 6 ? best.symbol : null;
}
