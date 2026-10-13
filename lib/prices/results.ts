// The figures a company's results announcement gives, read from the text of
// its filing (lib/pdf/pos-text.ts extracts the lines): the period and its end,
// earnings per share, profit after tax, and a cash dividend declared. Each is
// the current period's (the first figure on its line, before the comparative);
// a scanned filing has no text and gives nothing. What is read is evidence for
// a draft assumption the owner approves (lib/valuation/draft.ts), never an
// input on its own. Pure, so scripts/test-valuation.ts runs it.

import { statementUnit } from "./balance-sheet";

export type ResultFigures = {
  period: "year" | "nine months" | "half year" | "quarter" | null;
  periodEnd: string | null; // yyyy-mm-dd
  eps: number | null;
  profit: number | null; // rupees
  dps: number | null; // rupees a share
  text: boolean; // the filing had text to read
  // Read from its statements by the home machine's model (lib/valuation/read-filing.ts):
  epsPrior?: number | null; // the same period a year before
  equity?: number | null; // rupees, at periodEnd
  revaluation?: number | null; // rupees: the revaluation surplus within equity
  basis?: "unconsolidated" | "consolidated" | null;
  source?: "text" | "model";
  checks?: string[];
};

const MONTHS: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

const num = (s: string): number | null => {
  const neg = /^\(.*\)$/.test(s.trim()) || s.trim().startsWith("-");
  const v = Number(s.replace(/[(),\s-]/g, ""));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
};

// The board's results letter, the day the figures are new; a report sent
// later ("Transmission of Annual Report ...") repeats them.
export const isResultsLetter = (title: string) => /results/i.test(title) && !/transmission|annual report|quarterly report/i.test(title);

// "for the year ended June 30, 2026", "half year ended 31 December 2025".
export function periodOf(text: string): { period: ResultFigures["period"]; periodEnd: string | null } {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const m = t.match(/(year|nine months|9 months|half[- ]year|six months|6 months|quarter|three months|3 months|period)\s+ended\s+(?:on\s+)?([a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+,?\s+\d{4})/);
  if (!m) return { period: null, periodEnd: null };
  const kind = m[1];
  const period: ResultFigures["period"] = kind === "year" ? "year" : /nine|9/.test(kind) ? "nine months" : /half|six|6/.test(kind) ? "half year" : /quarter|three|3/.test(kind) ? "quarter" : null;
  const d = m[2].replace(/(st|nd|rd|th)\b/, "").replace(",", "").trim().split(/\s+/);
  let day: string, mon: string | undefined, year: string;
  if (/^\d/.test(d[0])) [day, mon, year] = [d[0], MONTHS[d[1]], d[2]];
  else [mon, day, year] = [MONTHS[d[0]], d[1], d[2]];
  return { period, periodEnd: mon ? `${year}-${mon}-${day.padStart(2, "0")}` : null };
}

// The first figure after a label on its line (the current period), or on the
// next line when the label stands alone.
function figureAfter(lines: string[], label: RegExp, money = false): number | null {
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].search(label);
    if (at < 0) continue;
    const rest = [lines[i].slice(at).replace(label, " "), lines[i + 1] ?? ""];
    for (const r of rest) {
      if (money) {
        const m = r.match(/\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|\(?-?\d+(?:\.\d+)?\)?/g) ?? [];
        const v = m.map(num).find((x) => x != null && Math.abs(x) >= 1000);
        if (v != null) return v;
      } else {
        // A per-share figure has paisa; a bare small number is a note's.
        const m = r.match(/\(?-?\d+(?:,\d{3})*\.\d+\)?/g) ?? [];
        const v = m.map(num).find((x) => x != null && Math.abs(x) < 100000);
        if (v != null) return v;
      }
    }
  }
  return null;
}

export function parseResultFigures(pages: string[][]): ResultFigures {
  const lines = pages.flat().map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join("\n");
  if (text.replace(/\s/g, "").length < 200) return { period: null, periodEnd: null, eps: null, profit: null, dps: null, text: false };
  const { period, periodEnd } = periodOf(text);
  const eps = figureAfter(lines, /(basic\s+(and|&)\s+diluted\s+)?earnings\s*\/?\s*(\(loss\)\s*)?per\s+share(\s*-\s*basic(\s+(and|&)\s+diluted)?)?(\s*\(\s*rupees?\s*\)|\s*\(\s*rs\.?\s*\))?/i);
  const unit = statementUnit(lines);
  const pat = figureAfter(lines, /profit\s*(\/\s*\(loss\)\s*)?(for the (year|period)\s*)?after\s+tax(ation)?/i, true);
  // "a final cash dividend of Rs. 5.00 per share i.e. 50%", or the percent alone.
  const dps = dividendOf(text);
  return { period, periodEnd, eps, profit: pat != null ? pat * unit : null, dps: dps != null && Number.isFinite(dps) && dps > 0 ? dps : null, text: true };
}

// The cash dividend a letter declares, in rupees a share, from the first
// mention that gives one (the company's own; a review further on often
// quotes its investees'): "125% of the face value of Re.1/- per share i.e.
// Rs.1.25" is 1.25; "Rs. 3.5 per share i.e. 35%" is 3.5; a percent alone is
// of the face value printed, Rs 10 where none is.
export function dividendOf(text: string): number | null {
  const t = text.replace(/\s+/g, " ");
  const face = Number(t.match(/face value of\s*(?:rs|re|pkr)\.?\s*(\d+(?:\.\d+)?)/i)?.[1] ?? 10);
  for (const m of t.matchAll(/cash dividend/gi)) {
    const w = t.slice(m.index! + m[0].length, m.index! + m[0].length + 200);
    const restated = w.match(/\bi\.?\s*e\.?,?\s*(?:rs|re|pkr)\.?\s*(\d+(?:\.\d+)?)/i);
    if (restated) return Number(restated[1]);
    for (const r of w.matchAll(/(?:rs|re|pkr)\.?\s*(\d+(?:\.\d+)?)\s*(?:\/-)?\s*per share/gi)) {
      if (/face value of\s*$/i.test(w.slice(0, r.index!))) continue;
      return Number(r[1]);
    }
    const pct = w.match(/@?\s*(\d+(?:\.\d+)?)\s*%/);
    if (pct) return (Number(pct[1]) / 100) * face;
  }
  return null;
}
