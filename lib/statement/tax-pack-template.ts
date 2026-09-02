// The filing pack — pure template layer (no server imports), so the shape can
// be tested without a database.
//
// The CSV export has covered dividends and disposals for a while. This is the
// document you hand to an accountant, and it carries the two things a
// spreadsheet of transactions cannot:
//
//   1. Your open positions AS AT 30 JUNE, with the FIFO cost of each lot. That
//      is what the wealth statement asks for, and it is the one figure nobody
//      can reconstruct in April from a year-old brokerage app.
//
//   2. An explicit list of what is NOT in here. A pack that quietly omits your
//      bank profit and your salary looks complete and is not, and a return
//      filed on it is wrong in a way that is hard to notice.

export type TaxPackData = {
  yearLabel: string; // "Tax Year 2026"
  fbrName: string;
  periodLine: string; // "1 July 2025 to 30 June 2026"
  generatedOn: string;
  filerStatus: string;

  dividends: Array<{ symbol: string; count: number; gross: number; wht: number; zakat: number; net: number }>;
  divTotals: { gross: number; wht: number; zakat: number; net: number };

  disposals: Array<{
    soldDate: string;
    symbol: string;
    shares: number;
    acquired: string;
    holdingDays: number;
    longTerm: boolean;
    cost: number;
    proceeds: number;
    gain: number;
  }>;
  cgt: { netGain: number; longTermGain: number; shortTermGain: number; cgt: number; rate: number };

  // Open positions at the close of the tax year, at FIFO cost.
  yearEndDate: string;
  holdings: Array<{ symbol: string; shares: number; cost: number; lots: number; oldest: string }>;
  holdingsCost: number;

  notes: string[];
  warnings: string[];
};

const esc = (s: string): string =>
  String(s ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");

const rs = (v: number): string => Math.round(v).toLocaleString("en-PK");
const rs2 = (v: number): string =>
  v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildTaxPackTex(d: TaxPackData): string {
  const divRows = d.dividends
    .map(
      (r) =>
        `${esc(r.symbol)} & ${r.count} & ${rs2(r.gross)} & ${rs2(r.wht)} & ${rs2(r.zakat)} & ${rs2(r.net)} \\\\`
    )
    .join("\n");

  const divTotalRow = `\\midrule\\bfseries Total & \\bfseries ${d.dividends.reduce(
    (s, r) => s + r.count,
    0
  )} & \\bfseries ${rs2(d.divTotals.gross)} & \\bfseries ${rs2(d.divTotals.wht)} & \\bfseries ${rs2(
    d.divTotals.zakat
  )} & \\bfseries ${rs2(d.divTotals.net)} \\\\`;

  const dispRows = d.disposals
    .map(
      (x) =>
        `${x.soldDate} & ${esc(x.symbol)} & ${rs(x.shares)} & ${x.acquired} & ${x.holdingDays} & ${
          x.longTerm ? "yes" : "no"
        } & ${rs2(x.cost)} & ${rs2(x.proceeds)} & ${rs2(x.gain)} \\\\`
    )
    .join("\n");

  const holdRows = d.holdings
    .map((h) => `${esc(h.symbol)} & ${rs(h.shares)} & ${h.lots} & ${h.oldest} & ${rs2(h.cost)} \\\\`)
    .join("\n");

  const noteItems = d.notes.map((n) => `\\item ${esc(n)}`).join("\n");
  const warnItems = d.warnings.map((n) => `\\item ${esc(n)}`).join("\n");

  const emptyDiv = d.dividends.length === 0;
  const emptyDisp = d.disposals.length === 0;
  const emptyHold = d.holdings.length === 0;

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=1.8cm]{geometry}
\\usepackage{booktabs}
\\usepackage{longtable}
\\setlength{\\parindent}{0pt}
\\setlength{\\tabcolsep}{5pt}
\\renewcommand{\\arraystretch}{1.15}
\\begin{document}

{\\LARGE\\bfseries Filing pack}\\par
\\vspace{2pt}
{\\large ${esc(d.fbrName)}}\\hfill{\\small generated ${esc(d.generatedOn)}}\\par
{\\small ${esc(d.periodLine)} \\quad\\textbullet\\quad filing as ${esc(d.filerStatus)}}\\par
\\vspace{6pt}\\hrule\\vspace{12pt}

{\\large\\bfseries 1. Dividends received}\\par
{\\small Section 150. Built from the dividend warrants recorded in the app, grouped by payer.}\\par
\\vspace{6pt}
${
  emptyDiv
    ? "{\\itshape No dividend warrants are recorded for this tax year.}\\par"
    : `\\begin{longtable}{@{}lrrrrr@{}}\\toprule
Payer & Payouts & Gross & Tax withheld & Zakat & Net \\\\\\midrule\\endhead
${divRows}
${divTotalRow}
\\bottomrule
\\end{longtable}`
}

\\vspace{10pt}
{\\large\\bfseries 2. Capital gains}\\par
{\\small FIFO disposals with actual acquisition dates and holding periods, which is what the PSX capital gains schedule is tiered on.}\\par
\\vspace{6pt}
${
  emptyDisp
    ? "{\\itshape No shares were sold in this tax year.}\\par"
    : `\\begin{longtable}{@{}llrlrlrrr@{}}\\toprule
Sold & Symbol & Shares & Acquired & Days & Long & Cost & Proceeds & Gain \\\\\\midrule\\endhead
${dispRows}
\\bottomrule
\\end{longtable}

\\vspace{4pt}
\\begin{tabular}{@{}lr@{}}\\toprule
Net gain for the year & ${rs2(d.cgt.netGain)} \\\\
\\quad of which held over a year & ${rs2(d.cgt.longTermGain)} \\\\
\\quad of which held under a year & ${rs2(d.cgt.shortTermGain)} \\\\\\midrule
Capital gains tax at ${d.cgt.rate}\\% & \\bfseries ${rs2(d.cgt.cgt)} \\\\
\\bottomrule
\\end{tabular}\\par
\\vspace{4pt}
{\\small The single rate above is the one set in the app. The published schedule is tiered by acquisition date and holding period, so the per-disposal table is the part to hand your accountant. Treat this total as a check figure, not a computation of what is due.}\\par`
}

\\vspace{14pt}
{\\large\\bfseries 3. Shares held at ${esc(d.yearEndDate)}}\\par
{\\small For the wealth statement. Cost is the FIFO cost of the lots still open on that date, not today's market value, and not what you paid on average across a position you have partly sold.}\\par
\\vspace{6pt}
${
  emptyHold
    ? "{\\itshape No open positions at the close of this tax year.}\\par"
    : `\\begin{longtable}{@{}lrrlr@{}}\\toprule
Symbol & Shares & Lots & Oldest lot & Cost \\\\\\midrule\\endhead
${holdRows}
\\midrule
\\bfseries Total & & & & \\bfseries ${rs2(d.holdingsCost)} \\\\
\\bottomrule
\\end{longtable}`
}

\\vspace{10pt}
{\\large\\bfseries 4. What this pack does not cover}\\par
\\vspace{4pt}
\\begin{itemize}\\setlength{\\itemsep}{2pt}
${noteItems}
\\end{itemize}

${
  d.warnings.length > 0
    ? `\\vspace{8pt}
{\\large\\bfseries 5. Check these before filing}\\par
\\vspace{4pt}
\\begin{itemize}\\setlength{\\itemsep}{2pt}
${warnItems}
\\end{itemize}`
    : ""
}

\\vspace{14pt}\\hrule\\vspace{4pt}
{\\footnotesize This pack is assembled from the transactions you recorded. It is a working paper for you and your accountant, not a return and not tax advice. Verify every figure against your brokerage statements and the current FBR schedule before filing.}\\par

\\end{document}
`;
}
