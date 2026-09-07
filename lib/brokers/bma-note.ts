// BMA Capital contract-note parser (PURCHASE / SALE confirmations).
//
// Design rule: this parser REFUSES to produce import rows unless the note
// reconciles arithmetically — every row must satisfy qty × netRate ≈ amount,
// rows must sum to the stated TOTAL, and TOTAL ± S.S.T must equal the GRAND
// TOTAL. A layout surprise therefore fails loudly with the raw lines attached,
// and never imports wrong numbers. S.S.T (15% sales tax on brokerage) is
// allocated to rows in proportion to each row's commission — the convention
// proven against five real notes to reconcile to the paisa.

export type NoteRow = {
  symbol: string;
  name: string;
  qty: number;
  marketRate: number;
  commPerShare: number;
  netRate: number;
  amount: number; // payable (buy) / receivable (sell), per the note
};

export type Confirmation = {
  side: "BUY" | "SELL";
  tradeDate: string; // ISO
  rows: NoteRow[];
  totalQty: number | null;
  totalAmount: number | null; // sum of row amounts as stated
  sst: number | null;
  grandTotal: number | null;
  problems: string[]; // non-empty = do NOT import
};

export type ImportRow = {
  symbol: string;
  type: "BUY" | "SELL";
  date: string;
  shares: number;
  price: number; // MARKET rate — fees carried separately
  fees: number; // commission + allocated SST share
  notes: string;
};

const num = (s: string): number => Number(s.replace(/,/g, ""));
const close = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= tol;

// "30/07/2026" → "2026-07-30"
function toIso(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export function parseBmaNote(pages: string[][]): Confirmation[] {
  const out: Confirmation[] = [];
  for (const lines of pages) {
    const joined = lines.join("\n");
    const isBuy = /PURCHASE\s+CONFIRMATION/i.test(joined);
    const isSell = /SALE\s+CONFIRMATION/i.test(joined);
    if (!isBuy && !isSell) continue;
    const problems: string[] = [];

    // Trade date: a dd/mm/yyyy on or near the "Trade Date" line.
    let tradeDate = "";
    for (let i = 0; i < lines.length; i++) {
      if (/Trade Date/i.test(lines[i])) {
        const m = /(\d{2}\/\d{2}\/\d{4})/.exec(lines[i]) ?? /(\d{2}\/\d{2}\/\d{4})/.exec(lines[i - 1] ?? "") ?? /(\d{2}\/\d{2}\/\d{4})/.exec(lines[i + 1] ?? "");
        if (m) tradeDate = toIso(m[1]);
        break;
      }
    }
    if (!tradeDate) {
      const m = /(\d{2}\/\d{2}\/\d{4})/.exec(joined);
      if (m) tradeDate = toIso(m[1]);
      else problems.push("trade date not found");
    }

    // Rows: with positional lines each trade reconstructs as one line —
    //   [qty] SYMBOL - PK########## - NAME [qty] market comm net amount [qty]
    // BMA has printed the quantity in three different places across the notes
    // seen so far: leading, between the company name and the market rate, and
    // trailing. All three are accepted; the four money columns are what
    // actually identify the row, and every one of them is still checked against
    // the others below.
    const rows: NoteRow[] = [];
    const rowRe =
      /^\s*([\d,]+)?\s*([A-Z]{2,8})\s*-\s*PK\w{10}\s*-\s*(.+?)\s+(?:([\d,]+)\s+)?([\d,]+\.\d{4})\s+([\d,]*\.\d{4})\s+([\d,]+\.\d{4})\s+([\d,]+\.\d{2})\s*([\d,]+)?\s*$/;
    for (const line of lines) {
      const m = rowRe.exec(line);
      if (!m) continue;
      const qtyRaw = m[1] ?? m[4] ?? m[9];
      const qty = qtyRaw != null ? num(qtyRaw) : NaN;
      if (!Number.isFinite(qty) || qty <= 0) {
        problems.push(`row without quantity: "${line.slice(0, 80)}"`);
        continue;
      }
      rows.push({
        symbol: m[2],
        name: m[3].trim(),
        qty,
        marketRate: num(m[5]),
        commPerShare: num(m[6]),
        netRate: num(m[7]),
        amount: num(m[8]),
      });
    }
    if (rows.length === 0) problems.push("no trade rows recognised — layout may have changed; nothing imported");

    // Note-level figures.
    const sstM = /S\.?S\.?T\.?\s*\.?\s*([\d,]+\.\d{2})/i.exec(joined) ?? /([\d,]+\.\d{2})\s*\n?\s*S\.?S\.?T/i.exec(joined);
    const sst = sstM ? num(sstM[1]) : null;
    const grandM = /G\s*R\s*A\s*N\s*D\s+T\s*O\s*T\s*A\s*L\s*\.?\s*([\d,]+\.\d{2})/i.exec(joined);
    const grandTotal = grandM ? num(grandM[1]) : null;
    const rowSum = rows.reduce((s, r) => s + r.amount, 0);
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);

    // The reconciliation gates.
    for (const r of rows) {
      if (!close(r.qty * r.netRate, r.amount)) problems.push(`${r.symbol}: qty×netRate ${(r.qty * r.netRate).toFixed(2)} ≠ amount ${r.amount.toFixed(2)}`);
      const expectedNet = isBuy ? r.marketRate + r.commPerShare : r.marketRate - r.commPerShare;
      if (!close(expectedNet, r.netRate, 0.001)) problems.push(`${r.symbol}: market${isBuy ? "+" : "−"}comm ${expectedNet.toFixed(4)} ≠ netRate ${r.netRate.toFixed(4)}`);
    }
    if (grandTotal != null && sst != null && rows.length > 0) {
      const expected = isBuy ? rowSum + sst : rowSum - sst;
      if (!close(expected, grandTotal, 0.05)) problems.push(`rows ${rowSum.toFixed(2)} ${isBuy ? "+" : "−"} SST ${sst.toFixed(2)} ≠ grand total ${grandTotal.toFixed(2)}`);
    } else if (rows.length > 0) {
      if (sst == null) problems.push("S.S.T figure not found");
      if (grandTotal == null) problems.push("grand total not found");
    }

    out.push({ side: isBuy ? "BUY" : "SELL", tradeDate, rows, totalQty: totalQty || null, totalAmount: rowSum || null, sst, grandTotal, problems });
  }
  return out;
}

// Confirmation → import rows. Same-symbol same-price fills merge (a 111+3+1+5
// HUBC day becomes one 120-share row); SST is split by each row's commission.
export function toImportRows(c: Confirmation): ImportRow[] {
  if (c.problems.length > 0) return [];
  const totalComm = c.rows.reduce((s, r) => s + r.qty * r.commPerShare, 0);
  const merged = new Map<string, { symbol: string; qty: number; marketRate: number; comm: number }>();
  for (const r of c.rows) {
    const key = `${r.symbol}@${r.marketRate}`;
    const m = merged.get(key) ?? { symbol: r.symbol, qty: 0, marketRate: r.marketRate, comm: 0 };
    m.qty += r.qty;
    m.comm += r.qty * r.commPerShare;
    merged.set(key, m);
  }
  return [...merged.values()].map((m) => {
    const sstShare = totalComm > 0 && c.sst != null ? (c.sst * m.comm) / totalComm : 0;
    return {
      symbol: m.symbol,
      type: c.side,
      date: c.tradeDate,
      shares: m.qty,
      price: m.marketRate,
      fees: Math.round((m.comm + sstShare) * 100) / 100,
      notes: `BMA note ${c.tradeDate} (comm+SST)`,
    };
  });
}
