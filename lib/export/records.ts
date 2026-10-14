// Trades and dividends for a period, as a CSV or a PDF (typeset from LaTeX
// on the server): what the export page downloads. Trades alone, dividends
// alone, or both together, for one share or all of them. Pure, so
// scripts/test-export.ts runs it.

export type RecordKind = "trades" | "dividends" | "all";
export type RecordTx = {
  date: string; // yyyy-mm-dd
  type: string;
  symbol: string;
  shares: number;
  pricePerShare: number;
  totalAmount: number;
  fees: number;
  netAmount: number;
  taxDeducted: number;
  zakatDeducted: number;
  warrantNo: string;
  notes: string;
  ratio: string;
};
export type Selection = { from: string | null; to: string | null; kind: RecordKind; symbol: string | null; actions: boolean };

const ACTIONS = ["BONUS", "RIGHT", "SPLIT"];

export function selectRecords(txs: RecordTx[], sel: Selection): RecordTx[] {
  const want = (t: string) =>
    (sel.kind !== "dividends" && (t === "BUY" || t === "SELL" || (sel.actions && ACTIONS.includes(t)))) || (sel.kind !== "trades" && t === "DIVIDEND");
  return txs
    .filter((t) => want(t.type) && (!sel.from || t.date >= sel.from) && (!sel.to || t.date <= sel.to) && (!sel.symbol || t.symbol === sel.symbol))
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol) || a.type.localeCompare(b.type));
}

export type Totals = { count: number; buys: number; sells: number; dividends: number; bought: number; sold: number; fees: number; divGross: number; divTax: number; divZakat: number; divNet: number };

export function totalsOf(rows: RecordTx[]): Totals {
  const t: Totals = { count: rows.length, buys: 0, sells: 0, dividends: 0, bought: 0, sold: 0, fees: 0, divGross: 0, divTax: 0, divZakat: 0, divNet: 0 };
  for (const r of rows) {
    if (r.type === "BUY" || r.type === "RIGHT") {
      t.buys += r.type === "BUY" ? 1 : 0;
      t.bought += r.netAmount;
      t.fees += r.fees || 0;
    } else if (r.type === "SELL") {
      t.sells += 1;
      t.sold += r.netAmount;
      t.fees += r.fees || 0;
    } else if (r.type === "DIVIDEND") {
      t.dividends += 1;
      t.divGross += r.totalAmount;
      t.divTax += r.taxDeducted || 0;
      t.divZakat += r.zakatDeducted || 0;
      t.divNet += r.netAmount;
    }
  }
  return t;
}

// Money out is negative: a buy or a right paid for; a sale and a dividend
// bring money in; a bonus or a split moves none.
export const cashOf = (r: RecordTx) => (r.type === "BUY" || r.type === "RIGHT" ? -r.netAmount : r.type === "SELL" || r.type === "DIVIDEND" ? r.netAmount : 0);

const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "");
const cell = (c: string | number) => {
  const s = String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function recordsCsv(rows: RecordTx[], totals: Totals, title: string): string {
  const out: Array<Array<string | number>> = [
    [title],
    [],
    ["Date", "Type", "Symbol", "Shares", "Price / DPS", "Gross", "Fees", "Tax withheld", "Zakat", "Net", "Cash in/out", "Warrant", "Notes"],
    ...rows.map((r) => [r.date, r.type, r.symbol, Math.abs(r.shares), n2(r.pricePerShare), n2(r.totalAmount), n2(r.fees), n2(r.taxDeducted), n2(r.zakatDeducted), n2(r.netAmount), n2(cashOf(r)), r.warrantNo, r.type === "SPLIT" && r.ratio ? `${r.ratio}${r.notes ? `; ${r.notes}` : ""}` : r.notes]),
    [],
  ];
  if (totals.buys + totals.sells > 0) out.push(["Bought", n2(totals.bought)], ["Sold", n2(totals.sold)], ["Fees and levies", n2(totals.fees)]);
  if (totals.dividends > 0) out.push(["Dividends gross", n2(totals.divGross)], ["Tax withheld", n2(totals.divTax)], ["Zakat", n2(totals.divZakat)], ["Dividends net", n2(totals.divNet)]);
  out.push(["Records", totals.count]);
  return out.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

const esc = (s: string): string =>
  String(s ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
const rs = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label: Record<string, string> = { BUY: "Buy", SELL: "Sell", DIVIDEND: "Dividend", BONUS: "Bonus", RIGHT: "Right", SPLIT: "Split" };

export function recordsTex(rows: RecordTx[], totals: Totals, meta: { title: string; period: string; generatedOn: string }): string {
  const body = rows
    .map((r) => {
      const taxOrFees = r.type === "DIVIDEND" ? (r.taxDeducted || 0) + (r.zakatDeducted || 0) : r.fees || 0;
      return `${r.date} & ${label[r.type] ?? esc(r.type)} & ${esc(r.symbol)} & ${Math.abs(r.shares).toLocaleString("en-US")} & ${r.pricePerShare ? rs(r.pricePerShare) : ""} & ${r.totalAmount ? rs(r.totalAmount) : ""} & ${taxOrFees ? rs(taxOrFees) : ""} & ${r.netAmount ? rs(r.netAmount) : ""} \\\\`;
    })
    .join("\n");
  const sums: string[] = [];
  if (totals.buys + totals.sells > 0) sums.push(`Bought & ${rs(totals.bought)} \\\\`, `Sold & ${rs(totals.sold)} \\\\`, `Fees and levies & ${rs(totals.fees)} \\\\`);
  if (totals.dividends > 0) sums.push(`Dividends, gross & ${rs(totals.divGross)} \\\\`, `Tax withheld & ${rs(totals.divTax)} \\\\`, ...(totals.divZakat ? [`Zakat & ${rs(totals.divZakat)} \\\\`] : []), `Dividends, net & ${rs(totals.divNet)} \\\\`);
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=1.5cm]{geometry}
\\usepackage{booktabs}
\\usepackage{longtable}
\\setlength{\\parindent}{0pt}
\\setlength{\\tabcolsep}{4pt}
\\renewcommand{\\arraystretch}{1.12}
\\begin{document}

{\\LARGE\\bfseries ${esc(meta.title)}}\\par
\\vspace{2pt}
{\\small ${esc(meta.period)}}\\hfill{\\small generated ${esc(meta.generatedOn)}}\\par
\\vspace{6pt}\\hrule\\vspace{10pt}

\\begin{tabular}{@{}lr@{}}
${sums.join("\n")}
Records & ${totals.count} \\\\
\\end{tabular}

\\vspace{12pt}
${
  rows.length === 0
    ? "{\\small Nothing in this period.}"
    : `{\\small
\\begin{longtable}{@{}lllrrrrr@{}}\\toprule
Date & Type & Share & Shares & Price/DPS & Gross & Fees/tax & Net \\\\\\midrule
\\endhead
${body}
\\bottomrule
\\end{longtable}}`
}

\\vspace{8pt}
{\\footnotesize Net: what a trade cost or brought in after fees, and a dividend after tax and zakat. Fees/tax: brokerage and levies on a trade; tax and zakat withheld on a dividend.}

\\end{document}
`;
}
