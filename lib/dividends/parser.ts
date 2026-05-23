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

  // Date of Issue / Financial Year / Rate Per Security (Rs. X.XXXX) ...
  const dateRow = norm.match(
    /Date of Issue Financial Year Rate Per Security[^]*?(\d{2}-\d{2}-\d{4})\s+(\d{4}-\d{2,4})\s+Rs\.?\s*([\d.]+)/i
  );
  const issueDate = dateRow ? toIsoDate(dateRow[1]) : null;
  const financialYear = dateRow ? dateRow[2] : null;
  const ratePerSecurity = dateRow ? toNum(dateRow[3]) : null;

  // Warrant No. NoOfSecurities ZakatLiable — three integers after the header.
  const warrantRow = norm.match(
    /Warrant No\.\s+No\. of Securities\s+Securities Liable to Zakat\s+(\d+)\s+(\d+)\s+(\d+)/i
  );
  const warrantNo = warrantRow ? warrantRow[1] : null;
  const shares = warrantRow ? toNum(warrantRow[2]) : null;

  // Securities not Liable to Zakat + Amount of Dividend (Rs.) — int, decimal
  const amountRow = norm.match(
    /Securities not Liable to Zakat\s+Amount of Dividend \(Rs\.\)\s+(\d+)\s+([\d,.]+)/i
  );
  const grossAmount = amountRow ? toNum(amountRow[2]) : null;

  // Zakat Deducted (Rs.) Tax Deducted (Rs.) — two decimals
  const dedRow = norm.match(
    /Zakat Deducted \(Rs\.\)\s+Tax Deducted \(Rs\.\)\s+([\d,.]+)\s+([\d,.]+)/i
  );
  const zakatDeducted = dedRow ? toNum(dedRow[1]) : null;
  const taxDeducted = dedRow ? toNum(dedRow[2]) : null;

  // Amount Paid (Rs.) <num>
  const amountPaid = toNum(tail(/Amount Paid \(Rs\.\)\s+([\d,.]+)/i, norm));

  // Payment Status Payment Date STATUS DD-MM-YYYY
  const payRow = norm.match(
    /Payment Status\s+Payment Date\s+([A-Za-z]+)\s+(\d{2}-\d{2}-\d{4})/i
  );
  const paymentStatus = payRow ? payRow[1] : null;
  const paymentDate = payRow ? toIsoDate(payRow[2]) : null;

  // Dividend type from the disclosure prose.
  const typeMatch = norm.match(/details of the (\w+) dividend disbursed/i);
  const dividendType = typeMatch ? typeMatch[1] : null;

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
