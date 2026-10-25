// Weekly plan report — pure template layer (no server imports), so the shape
// can be tested without a database.
//
// The monthly statement answers "what happened". This one answers "what should
// I be doing on Monday", which is a different document: the week's answer
// first, then the strategy behind it, the regime and the money available. It
// is deliberately one page of decisions rather than a page of performance.

import { zoneRange, type Tranche } from "../strategy/plan";

export type WeeklyReportData = {
  weekKey: string; // FY26-27-W10
  weekLabel: string; // "week 10 of FY26-27, 6 September 2026"
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
  fundEarnedWeek: number; // what the money-market money threw off over the last seven days it was held
  fundEarnedPerDay: number;
  cashPlaces: Array<{ label: string; pkr: number; yieldPct: number | null }>; // where the available cash is
  cashLocked: Array<{ label: string; pkr: number; until: string }>; // deposits and bills not counted until they mature
  cashComing?: { in90: number; dividends: number; fixed: number; needs: number; shortBy: number } | null; // the cash calendar, not counted as cash
  // Stocks above the allocation target: the week's answer is no buying,
  // whatever the buy zones say.
  gateLine: string | null;

  // the week's answer, from the strategy's buy zones (weekAction)
  indexName: string;
  indexLevel: number;
  indexAsOf: string;
  action: string; // DEPLOY | WAIT
  actionLine: string;

  // positions
  positions: Array<{ symbol: string; weightPct: number; value: number; priceKnown: boolean }>;
  parked: Array<{ symbol: string; shares: number; value: number }>; // kept for the companies' reports; outside the figures

  // the strategy page: its plan, its buy zones and the month's rates
  strategy: {
    steps: string[];
    zones: Array<{ range: string; why: string; reached: boolean }>;
    rates: { label: string; values: Array<[string, number | null]> } | null;
  } | null;
};

const esc = (s: string): string =>
  String(s ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");

const rs = (v: number): string => `Rs ${Math.round(v).toLocaleString("en-PK")}`;
const sgn = (v: number): string => (v >= 0 ? `+${v}` : `$-$${Math.abs(v)}`);
const dashed = (s: string): string => esc(s).replace(/–/g, "--");

// The week's answer from the strategy alone: no buying with stocks above their
// target; the money due when the KSE-100 is in a buy zone; otherwise the next
// zone and what it would put to work.
export function weekAction(i: { level: number | null; tranches: Tranche[]; allocationLine: string; gate: string | null }): { action: "DEPLOY" | "WAIT"; line: string } {
  if (i.level == null || !(i.level > 0)) return { action: "WAIT", line: "No KSE-100 level this week." };
  const at = `KSE-100 ${Math.round(i.level).toLocaleString("en-PK")}`;
  if (i.gate) return { action: "WAIT", line: `${i.gate} ${at}.` };
  const live = i.tranches.filter((t) => t.amount >= 1);
  const due = live.filter((t) => t.due);
  const next = live.find((t) => !t.due);
  if (due.length) {
    const amount = due.reduce((s, t) => s + t.amount, 0);
    return { action: "DEPLOY", line: `Put ${rs(amount)} to work: ${at} is in zone${due.length > 1 ? "s" : ""} ${due.map((t) => `${t.n} (${zoneRange(t)})`).join(", ")}.` };
  }
  if (next) return { action: "WAIT", line: `${at}. Next zone ${zoneRange(next)}: ${rs(next.amount)}.` };
  return { action: "WAIT", line: `${at}. ${i.allocationLine.replace(/\.$/, "")}.` };
}

// Weeks of the financial year (July to June), counted in Karachi: week 1 is
// 1 to 7 July, week 2 from 8 July, and so on to week 53 at the end of June.
export function weekOf(now = new Date()): { key: string; label: string } {
  const pk = new Date(now.getTime() + 5 * 3600_000);
  const y = pk.getUTCFullYear(), m = pk.getUTCMonth();
  const startYear = m >= 6 ? y : y - 1;
  const day = Date.UTC(y, m, pk.getUTCDate());
  const week = Math.floor((day - Date.UTC(startYear, 6, 1)) / (7 * 86400000)) + 1;
  const fy = `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
  const date = new Date(day).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return { key: `${fy}-W${String(week).padStart(2, "0")}`, label: `week ${week} of ${fy}, ${date}` };
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

  const posRows = d.positions
    .map(
      (p) =>
        `${esc(p.symbol)} & ${p.priceKnown ? rs(p.value) : "no price"} & ${
          p.priceKnown ? p.weightPct.toFixed(1) + "\\%" : "---"
        } \\\\`
    )
    .join("\n");

  const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : iso);
  const st = d.strategy;
  const strategyBlock = st
    ? `\\vspace{12pt}
{\\large\\bfseries Strategy}${d.indexLevel > 0 ? `\\quad{\\small ${esc(d.indexName)} at ${Math.round(d.indexLevel).toLocaleString("en-PK")}${d.indexAsOf ? ` (${esc(day(d.indexAsOf))})` : ""}}` : ""}\\par
\\vspace{3pt}
${st.steps.map((x) => `\\textbullet\\ ${dashed(x)}\\par`).join("\n")}
${st.zones.length ? `\\vspace{2pt}{\\footnotesize Buy zones: ${st.zones.map((z, k) => `${k + 1}) ${esc(z.range).replace(/–/g, "--")} ${esc(z.why).replace(/·/g, "/")}${z.reached ? ", reached" : ""}`).join("; ")}.}\\par` : ""}
${
  st.rates
    ? `\\vspace{6pt}{\\small\\bfseries Rates, ${esc(st.rates.label)}}\\par
\\vspace{2pt}
\\begin{tabular}{@{}${"r".repeat(st.rates.values.length)}@{}}\\toprule ${st.rates.values.map(([k]) => esc(k)).join(" & ")} \\\\\\midrule
${st.rates.values.map(([, v]) => (v == null ? "---" : `${v.toFixed(2)}\\%`)).join(" & ")} \\\\
\\bottomrule\\end{tabular}\\par`
    : ""
}`
    : "";

  const deploy = d.action === "DEPLOY";
  const actionBox = `\\fbox{\\parbox{\\dimexpr\\textwidth-2\\fboxsep-2\\fboxrule}{\\bfseries ${deploy ? "ACTION THIS WEEK" : "NO ACTION THIS WEEK"}\\par\\vspace{3pt}\\normalfont ${dashed(d.actionLine)}}}`;
  const placeRows = d.cashPlaces.map((p) => `\\quad ${esc(p.label)}${p.yieldPct != null ? ` (${p.yieldPct.toFixed(2)}\\%)` : ""} & ${rs(p.pkr)} \\\\`).join("\n");
  const lockedRows = d.cashLocked.map((p) => `${esc(p.label)}, locked to ${esc(day(p.until))} & ${rs(p.pkr)} \\\\`).join("\n");

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
${strategyBlock}

\\vspace{12pt}
{\\large\\bfseries Regime:${esc(d.regimeLabel)}}\\quad{\\small score ${sgn(d.rawScore)} of ${d.maxScore}, confidence ${esc(
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
${placeRows}
${d.cashReceivable >= 1 ? `Receivable & ${rs(d.cashReceivable)} \\\\` : ""}
${d.cashExpected >= 1 ? `Expected & ${rs(d.cashExpected)} \\\\` : ""}
${lockedRows}
${d.cashComing && d.cashComing.in90 >= 1 ? `Coming in, 90 days (dividends ${rs(d.cashComing.dividends)}, bills and deposits ${rs(d.cashComing.fixed)}) & ${rs(d.cashComing.in90)} \\\\` : ""}
${d.cashComing && d.cashComing.needs >= 1 ? `Price-rule adds would need & ${rs(d.cashComing.needs)} \\\\` : ""}
\\midrule
Equities at market & ${rs(d.equityValue)} \\\\
Net worth & ${rs(d.netWorth)} \\\\
\\bottomrule\\end{tabular}
\\par\\vspace{4pt}
Cash is ${d.cashPct.toFixed(0)}\\% of investable. ${esc(d.cashCheckLine)}\\par
${d.fundEarnedPerDay > 0 ? `\\vspace{2pt}{\\footnotesize The money-market fund earns about ${rs(d.fundEarnedPerDay)} a day: ${rs(d.fundEarnedWeek)} over the past week, for the days it was held.}\\par` : ""}

\\vspace{12pt}
{\\large\\bfseries Positions}\\par
\\vspace{4pt}
${
  d.positions.length
    ? `\\begin{tabular}{@{}lrr@{}}\\toprule Symbol & Value & Weight \\\\\\midrule\n${posRows}\n\\bottomrule\\end{tabular}`
    : "{\\footnotesize No positions.}"
}
${d.parked.length ? `\\par\\vspace{3pt}{\\footnotesize Parked, in net worth but not in these weights: ${esc(d.parked.map((p) => `${p.symbol} ${p.shares.toLocaleString()}`).join(", "))}.}` : ""}

\\vspace{14pt}\\hrule\\vspace{4pt}
{\\footnotesize The buy zones come from the data, not from levels typed in. Nothing here is advice, and nothing trades itself.}

\\end{document}
`;
}
