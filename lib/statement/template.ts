// Monthly PDF statement — pure template layer (no server imports), so the
// LaTeX can be unit-tested and compiled locally without the app's data layer.

export type MonthlyStatementData = {
  monthLabel: string; // "July 2026"
  monthKey: string; // "2026-07"
  generatedOn: string;
  netWorthTotal: number;
  equity: number;
  funds: number;
  savingsAndCash: number;
  usdEquivalent: number | null;
  unrealizedPL: number;
  unrealizedPct: number | null;
  xirrPct: number | null;
  realXirrPct: number | null;
  inflationPct: number | null;
  movers: Array<{ symbol: string; contribution: number }>;
  moversPartial: boolean;
  dividends: Array<{ symbol: string; date: string; net: number }>;
  dividendTotal: number;
  trades: Array<{ date: string; type: string; symbol: string; shares: number; price: number }>;
  decisions: Array<{ date: string; symbol: string; action: string; rationale: string }>;
  positions: Array<{ symbol: string; shares: number; value: number; weightPct: number; priceKnown: boolean }>;
  unpriced: string[];
};

// The month that just ENDED relative to `now` (run on the 1st → last month).
export function statementMonth(now = new Date()): { key: string; label: string; from: string; to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(first.getTime() - 86400000); // last day of previous month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const label = start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { key: start.toISOString().slice(0, 7), label, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}


const esc = (s: string) => s.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
const rs = (n: number) => `Rs~${Math.round(n).toLocaleString("en-PK")}`;
const pct = (n: number | null, dp = 1) => (n == null ? "---" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}\\%`);

export function buildStatementTex(d: MonthlyStatementData): string {
  const moverRows = d.movers.map((m) => `${esc(m.symbol)} & ${m.contribution >= 0 ? "+" : "$-$"}${rs(Math.abs(m.contribution)).slice(3)} \\\\`).join("\n");
  const divRows = d.dividends.map((x) => `${x.date} & ${esc(x.symbol)} & ${rs(x.net)} \\\\`).join("\n");
  const tradeRows = d.trades.map((t) => `${t.date} & ${t.type} & ${esc(t.symbol)} & ${t.shares.toLocaleString()} & ${t.price.toFixed(2)} \\\\`).join("\n");
  const decRows = d.decisions.map((x) => `${x.date} & ${esc(x.symbol)} & ${esc(x.action)} & \\parbox[t]{7.2cm}{\\footnotesize ${esc(x.rationale)}} \\\\`).join("\n");
  const posRows = d.positions
    .map((p) => `${esc(p.symbol)} & ${p.shares.toLocaleString()} & ${p.priceKnown ? rs(p.value) : "no price"} & ${p.priceKnown ? p.weightPct.toFixed(1) + "\\%" : "---"} \\\\`)
    .join("\n");

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=2.2cm]{geometry}
\\usepackage{booktabs}
\\usepackage{tabularx}
\\setlength{\\parindent}{0pt}
\\pagenumbering{gobble}
\\begin{document}

{\\LARGE\\bfseries PSX Portfolio --- Monthly Statement}\\par
\\vspace{2pt}
{\\large ${esc(d.monthLabel)}}\\hfill{\\small generated ${d.generatedOn}}\\par
\\vspace{6pt}\\hrule\\vspace{10pt}

{\\large\\bfseries Net worth: ${rs(d.netWorthTotal)}${d.usdEquivalent != null ? ` \\quad {\\normalsize(\\$${Math.round(d.usdEquivalent).toLocaleString()})}` : ""}}\\par
\\vspace{4pt}
Equities ${rs(d.equity)} \\quad Funds ${rs(d.funds)} \\quad Savings + cash ${rs(d.savingsAndCash)}\\par
Unrealised ${d.unrealizedPL >= 0 ? "+" : "$-$"}${rs(Math.abs(d.unrealizedPL)).slice(3)}${d.unrealizedPct != null ? ` (${pct(d.unrealizedPct)})` : ""} \\quad
XIRR ${pct(d.xirrPct)}${d.realXirrPct != null ? ` \\quad real ${pct(d.realXirrPct)} after ${d.inflationPct?.toFixed(1)}\\% CPI` : ""}\\par
${d.unpriced.length > 0 ? `\\vspace{4pt}{\\footnotesize No price for ${esc(d.unpriced.join(", "))} --- excluded from totals, not counted as losses.}\\par` : ""}

\\vspace{10pt}
\\begin{minipage}[t]{0.48\\textwidth}
{\\bfseries What moved it (30 days)}${d.moversPartial ? "{\\footnotesize\\ (partial window)}" : ""}\\par\\vspace{4pt}
${d.movers.length ? `\\begin{tabular}{@{}lr@{}}\\toprule Symbol & Contribution \\\\\\midrule\n${moverRows}\n\\bottomrule\\end{tabular}` : "{\\footnotesize No attribution data this month.}"}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.48\\textwidth}
{\\bfseries Dividends banked: ${rs(d.dividendTotal)}}\\par\\vspace{4pt}
${d.dividends.length ? `\\begin{tabular}{@{}llr@{}}\\toprule Date & Symbol & Net \\\\\\midrule\n${divRows}\n\\bottomrule\\end{tabular}` : "{\\footnotesize None this month.}"}
\\end{minipage}

\\vspace{12pt}
{\\bfseries Trades}\\par\\vspace{4pt}
${d.trades.length ? `\\begin{tabular}{@{}lllrr@{}}\\toprule Date & Side & Symbol & Shares & Price \\\\\\midrule\n${tradeRows}\n\\bottomrule\\end{tabular}` : "{\\footnotesize No buys or sells this month.}"}

\\vspace{12pt}
{\\bfseries Decisions logged}\\par\\vspace{4pt}
${d.decisions.length ? `\\begin{tabular}{@{}lllp{7.2cm}@{}}\\toprule Date & Symbol & Action & Rationale \\\\\\midrule\n${decRows}\n\\bottomrule\\end{tabular}` : "{\\footnotesize None --- no sells, trims, or logged holds this month.}"}

\\vspace{12pt}
{\\bfseries Positions at month end}\\par\\vspace{4pt}
\\begin{tabular}{@{}lrrr@{}}\\toprule Symbol & Shares & Value & Weight \\\\\\midrule
${posRows}
\\bottomrule\\end{tabular}

\\vspace{14pt}\\hrule\\vspace{4pt}
{\\footnotesize Values as of the generation date. Same live figures as the site; nothing here is advice, and nothing trades itself.}

\\end{document}
`;
}
