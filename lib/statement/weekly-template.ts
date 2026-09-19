// Weekly plan report — pure template layer (no server imports), so the shape
// can be tested without a database.
//
// The monthly statement answers "what happened". This one answers "what should
// I be doing on Monday", which is a different document: regime first, then the
// money available, then the levels that would spend it. It is deliberately one
// page of decisions rather than a page of performance.

export type WeeklyReportData = {
  weekKey: string; // 2026-W36
  weekLabel: string; // "week ending 6 September 2026"
  generatedOn: string;

  // regime
  regimeBand: string;
  regimeLabel: string;
  regimeLine: string;
  rawScore: number;
  maxScore: number;
  confidence: string;
  cashFloorPct: number;
  favour: string[];
  avoid: string[];
  signals: Array<{ label: string; source: string; score: number; reading: string; known: boolean }>;
  missing: string[];

  // money
  netWorth: number;
  equityValue: number;
  cashAvailable: number;
  cashReceivable: number;
  cashExpected: number;
  cashPct: number; // available cash as a share of investable
  cashCheckLine: string;
  cashCheckOk: boolean;
  fundEarnedWeek: number; // what the money-market money threw off this week
  fundEarnedPerDay: number;

  // ladder
  indexName: string;
  indexLevel: number;
  indexAsOf: string;
  ladderAction: string; // DEPLOY | WAIT | SET_UP
  ladderLine: string;
  rungs: Array<{
    level: number;
    pct: number;
    label: string;
    amount: number;
    status: string;
    moveRequiredPct: number;
  }>;
  ladderWarnings: string[];

  // positions
  positions: Array<{ symbol: string; weightPct: number; value: number; priceKnown: boolean }>;
  parked: Array<{ symbol: string; shares: number; value: number }>; // kept for the companies' reports; outside the figures
};

const esc = (s: string): string =>
  String(s ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");

const rs = (v: number): string => `Rs ${Math.round(v).toLocaleString("en-PK")}`;
const sgn = (v: number): string => (v >= 0 ? `+${v}` : `$-$${Math.abs(v)}`);

export function weekOf(now = new Date()): { key: string; label: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO week number.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const label = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return { key: `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, label: `week ending ${label}` };
}

export function buildWeeklyTex(d: WeeklyReportData): string {
  const sigRows = d.signals
    .map(
      (s) =>
        `${esc(s.label)} & ${s.source === "auto" ? "auto" : "yours"} & ${
          s.known ? sgn(s.score) : "---"
        } & \\parbox[t]{6.4cm}{\\footnotesize ${esc(s.reading)}} \\\\`
    )
    .join("\n");

  const rungRows = d.rungs
    .map(
      (r) =>
        `${Math.round(r.level).toLocaleString("en-PK")} & ${r.pct.toFixed(0)}\\% & ${rs(r.amount)} & ${esc(
          r.label || "---"
        )} & ${r.status === "READY" ? "\\bfseries READY" : r.status === "FIRED" ? "fired" : `${r.moveRequiredPct.toFixed(1)}\\%`} \\\\`
    )
    .join("\n");

  const posRows = d.positions
    .map(
      (p) =>
        `${esc(p.symbol)} & ${p.priceKnown ? rs(p.value) : "no price"} & ${
          p.priceKnown ? p.weightPct.toFixed(1) + "\\%" : "---"
        } \\\\`
    )
    .join("\n");

  const actionBox =
    d.ladderAction === "DEPLOY"
      ? `\\fbox{\\parbox{\\dimexpr\\textwidth-2\\fboxsep-2\\fboxrule}{\\bfseries ACTION THIS WEEK\\par\\vspace{3pt}\\normalfont ${esc(d.ladderLine)}}}`
      : `\\fbox{\\parbox{\\dimexpr\\textwidth-2\\fboxsep-2\\fboxrule}{\\bfseries NO ACTION THIS WEEK\\par\\vspace{3pt}\\normalfont ${esc(d.ladderLine)}}}`;

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=2.0cm]{geometry}
\\usepackage{booktabs}
\\usepackage{tabularx}
\\setlength{\\parindent}{0pt}
\\pagenumbering{gobble}
\\begin{document}

{\\LARGE\\bfseries Weekly Plan}\\par
\\vspace{2pt}
{\\large ${esc(d.weekLabel)}}\\hfill{\\small generated ${d.generatedOn}}\\par
\\vspace{6pt}\\hrule\\vspace{10pt}

${actionBox}

\\vspace{12pt}
{\\large\\bfseries Regime: ${esc(d.regimeLabel)}}\\quad{\\small score ${sgn(d.rawScore)} of ${d.maxScore}, confidence ${esc(
    d.confidence.toLowerCase()
  )}}\\par
\\vspace{3pt}
${esc(d.regimeLine)}\\par
\\vspace{4pt}
{\\footnotesize\\bfseries Favour:} {\\footnotesize ${esc(d.favour.join(", "))}}\\par
{\\footnotesize\\bfseries Avoid:} {\\footnotesize ${esc(d.avoid.join(", "))}}\\par

\\vspace{8pt}
\\begin{tabular}{@{}llrl@{}}\\toprule Signal & Source & Score & Reading \\\\\\midrule
${sigRows}
\\bottomrule\\end{tabular}
${d.missing.length ? `\\vspace{4pt}\\par{\\footnotesize Not set: ${esc(d.missing.join(", "))}. Until these are scored the total understates how much is unknown.}\\par` : ""}

\\vspace{12pt}
{\\large\\bfseries Money}\\par
\\vspace{4pt}
\\begin{tabular}{@{}lr@{}}\\toprule Source & Amount \\\\\\midrule
Cash available now & ${rs(d.cashAvailable)} \\\\
Receivable & ${rs(d.cashReceivable)} \\\\
Expected & ${rs(d.cashExpected)} \\\\
\\midrule
Equities at market & ${rs(d.equityValue)} \\\\
Net worth & ${rs(d.netWorth)} \\\\
\\bottomrule\\end{tabular}
\\par\\vspace{4pt}
Cash is ${d.cashPct.toFixed(0)}\\% of investable. ${esc(d.cashCheckLine)}\\par
${d.fundEarnedPerDay > 0 ? `\\vspace{2pt}{\\footnotesize The money-market balance earned about ${rs(d.fundEarnedWeek)} over the last seven days, roughly ${rs(d.fundEarnedPerDay)} a day, while it waited.}\\par` : ""}

\\vspace{12pt}
{\\large\\bfseries The ladder}\\quad{\\small ${esc(d.indexName)} at ${Math.round(d.indexLevel).toLocaleString("en-PK")}${
    d.indexAsOf ? ` (${esc(d.indexAsOf)})` : ""
  }}\\par
\\vspace{4pt}
${
  d.rungs.length
    ? `\\begin{tabular}{@{}rrrll@{}}\\toprule Level & Share & Amount & Note & Status \\\\\\midrule\n${rungRows}\n\\bottomrule\\end{tabular}`
    : "{\\footnotesize No ladder set. Until the levels are written down there is no rule, only mood.}"
}
${d.ladderWarnings.length ? `\\vspace{4pt}\\par{\\footnotesize ${esc(d.ladderWarnings.join(" "))}}\\par` : ""}

\\vspace{12pt}
{\\large\\bfseries Positions}\\par
\\vspace{4pt}
${
  d.positions.length
    ? `\\begin{tabular}{@{}lrr@{}}\\toprule Symbol & Value & Weight \\\\\\midrule\n${posRows}\n\\bottomrule\\end{tabular}`
    : "{\\footnotesize No positions.}"
}
${d.parked.length ? `\\par\\vspace{3pt}{\\footnotesize Parked, outside every figure here: ${esc(d.parked.map((p) => `${p.symbol} ${p.shares.toLocaleString()}`).join(", "))}.}` : ""}

\\vspace{14pt}\\hrule\\vspace{4pt}
{\\footnotesize The ladder is a rule, not a forecast. It tells you what your own levels commit you to this week and nothing more. Nothing here is advice, and nothing trades itself.}

\\end{document}
`;
}
