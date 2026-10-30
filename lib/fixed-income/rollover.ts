// A deposit that rolls over at maturity: the next term opens on the day the
// last one ends, for the same length, on the principal and, when the profit
// rolls too, the profit after tax, at the rate the bank pays then. Each term
// is its own record (lib/fixed-income/roll.ts links them), so a term's profit
// stays in the year it was made. Pure, so scripts/test-fixed-income.ts runs it.

import { depositFace, type FixedIncomeHolding } from "./value";

export type RolloverMode = "principal" | "all";

const DAY = 86400000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addMonths(d: string, months: number): string {
  const x = new Date(t(d));
  x.setUTCMonth(x.getUTCMonth() + months);
  return iso(x.getTime());
}

// A term of whole months (3 months: 12 Oct to 12 Jan), else null.
export function termMonths(from: string, to: string): number | null {
  for (let m = 1; m <= 120; m++) {
    const end = addMonths(from, m);
    if (end === to) return m;
    if (end > to) return null;
  }
  return null;
}

// The profit a term pays on its last day: a deposit paying at maturity its
// whole profit, one paying through the term its last payment.
export function profitAtMaturity(h: Pick<FixedIncomeHolding, "face" | "cost" | "couponPct" | "couponsPerYear">): number {
  return h.couponsPerYear > 0 ? (h.face * h.couponPct) / 100 / h.couponsPerYear : Math.max(0, h.face - h.cost);
}

export function nextTerm(h: FixedIncomeHolding, mode: RolloverMode, ratePct: number): Pick<FixedIncomeHolding, "cost" | "face" | "purchaseDate" | "maturityDate" | "couponPct" | "couponsPerYear" | "taxPct"> {
  const months = termMonths(h.purchaseDate, h.maturityDate);
  const start = h.maturityDate;
  const end = months ? addMonths(start, months) : iso(t(start) + Math.max(1, Math.round((t(h.maturityDate) - t(h.purchaseDate)) / DAY)) * DAY);
  const rolled = mode === "all" ? profitAtMaturity(h) * (1 - (h.taxPct || 0) / 100) : 0;
  const cost = Math.round((h.cost + rolled) * 100) / 100;
  return { cost, face: depositFace(cost, ratePct, start, end, h.couponsPerYear), purchaseDate: start, maturityDate: end, couponPct: ratePct, couponsPerYear: h.couponsPerYear, taxPct: h.taxPct };
}

export function rolledMessage(r: { name: string; cost: number; ratePct: number; to: string; estimated: boolean }): string {
  const until = new Date(t(r.to)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `🔁 <b>${r.name}</b> rolled over: Rs ${Math.round(r.cost).toLocaleString("en-PK")} to ${until} at ${r.ratePct}%${r.estimated ? " (estimated: send the new receipt)" : " (the bank's rate sheet)"}.`;
}

// Bank Alfalah's deposit rate sheet, its "Alfa Term Deposits (Digital)" table
// (the deposits booked in the Alfa app): the rate at maturity by term, in
// months. Rows read "3 Months 10.05% 10.15%" (monthly, at maturity) or
// "1 Month - 10.15%" (at maturity only); days are left out.
export function parseAlfaTermRates(text: string): Record<number, number> {
  const s = text.replace(/\s+/g, " ");
  const at = s.search(/Alfa Term Deposits \(Digital\)/i);
  if (at < 0) return {};
  const end = s.slice(at).search(/can only be booked|Floating Term/i);
  const part = s.slice(at, at + (end > 0 ? end : 700));
  const out: Record<number, number> = {};
  for (const m of part.matchAll(/(\d{1,2}) (Months?|Years?) (?:-|\d{1,2}(?:\.\d+)?%) (\d{1,2}(?:\.\d+)?)%/gi)) {
    const months = Number(m[1]) * (/year/i.test(m[2]) ? 12 : 1);
    const rate = Number(m[3]);
    if (months > 0 && rate > 0 && rate < 40 && out[months] == null) out[months] = rate;
  }
  return out;
}

// The date a rate sheet's file name carries ("... - 21st August 2026.pdf",
// "Rate Sheet 26Nov25.pdf"), as yyyy-mm-dd.
export function sheetDate(url: string): string | null {
  const s = decodeURIComponent(url).replace(/_/g, " ");
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let m = s.match(/(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}),? (\d{4})/);
  if (m && months.includes(m[2].slice(0, 3).toLowerCase())) return `${m[3]}-${String(months.indexOf(m[2].slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})([A-Za-z]{3})(\d{2})\.pdf/i);
  if (m && months.includes(m[2].toLowerCase())) return `20${m[3]}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
