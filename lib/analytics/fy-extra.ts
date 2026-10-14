// What the year table puts beside each financial year's share profit: the
// rest of the book (funds, savings, T-bills and deposits), and the market over
// the same year (the KSE-100, the KMI-30 and a 12-month T-bill). Pure, so
// scripts/test-fy-extra.ts runs it.
//
// The rest of the book is counted the way the Holding tab's total return
// counts it, so the years add up to that total:
//   - Funds: no fund prices are kept for past 30 Junes, so a fund's gain
//     counts in the year it was redeemed, and what the units held now have
//     gained counts in the year under way.
//   - Savings: the balance accrued at the account's rate, at each year's end.
//   - T-bills, sukuks and deposits still held: their worth at each year's end.

import { valueSavings, type SavingsMovement } from "@/lib/calculations/assets";
import { valueFixedIncome, type FixedIncomeHolding } from "@/lib/fixed-income/value";
import { policyRateOn, type RateStep } from "@/lib/timeseries/sbp-rate";
import { fyOf, type FyWindow } from "./fy-profit";

const DAY = 86400000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const dayBefore = (d: string) => iso(t(d) - DAY);

export type Close = { date: string; close: number };

// The last close on or before a date; none before the series starts.
export function closeOn(closes: Close[], date: string): number | null {
  let lo = 0, hi = closes.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && closes[found].close > 0 ? closes[found].close : null;
}

// An index over a financial year: from the last close before it to the
// year's last close (the latest, for the year under way). Price only: the
// index leaves dividends out.
export function indexChangePct(closes: Close[], fy: FyWindow): number | null {
  const a = closeOn(closes, dayBefore(fy.start));
  const b = closeOn(closes, fy.end);
  return a != null && b != null ? (b / a - 1) * 100 : null;
}

// A 12-month T-bill bought on the year's first day at `yieldPct`: its yield
// for a year that is over, the part earned so far for the year under way.
export function tbillPct(yieldPct: number, fy: FyWindow): number {
  if (!fy.current) return yieldPct;
  const days = Math.max(0, Math.round((t(fy.end) - t(dayBefore(fy.start))) / DAY));
  return (yieldPct * Math.min(365, days)) / 365;
}

// Money at the policy rate through the year, day by day, compounded: what
// stands in for the T-bill when no rate was kept for the year.
export function policyPct(steps: RateStep[], fy: FyWindow): number {
  let v = 1;
  for (let d = t(fy.start); d <= t(fy.end); d += DAY) v *= Math.pow(1 + policyRateOn(iso(d), steps) / 100, 1 / 365);
  return (v - 1) * 100;
}

export type FundYearInput = { trades: Array<{ date: string; side: string; realizedGain: number }>; openGain: number };
export type SavingsYearInput = { ratePercent: number; anchorDate: string; anchorBalance: number; movements: SavingsMovement[] };

export type OtherYear = { funds: number; savings: number; fixed: number };

// The rest of the book, a year at a time. `today` is Karachi's date.
export function otherByYear(input: { funds: FundYearInput[]; savings: SavingsYearInput[]; fixed: FixedIncomeHolding[] }, years: FyWindow[], today: string): Map<number, OtherYear> {
  const out = new Map<number, OtherYear>(years.map((y) => [y.endYear, { funds: 0, savings: 0, fixed: 0 }]));
  const cur = fyOf(today);
  const add = (endYear: number, k: keyof OtherYear, v: number) => {
    const row = out.get(endYear);
    if (row && Number.isFinite(v)) row[k] += v;
  };
  for (const f of input.funds) {
    for (const tr of f.trades) if (tr.side === "REDEEM") add(fyOf(tr.date), "funds", tr.realizedGain || 0);
    add(cur, "funds", f.openGain || 0);
  }
  for (const y of years) {
    const from = dayBefore(y.start), to = y.end < today ? y.end : today;
    for (const a of input.savings) {
      const before = from < a.anchorDate ? 0 : valueSavings(a, from).profit;
      const after = to < a.anchorDate ? 0 : valueSavings(a, to).profit;
      add(y.endYear, "savings", after - before);
    }
    for (const h of input.fixed) {
      const profitOn = (d: string) => (d < h.purchaseDate ? 0 : valueFixedIncome(h, d).profitSoFar);
      add(y.endYear, "fixed", profitOn(to) - profitOn(from));
    }
  }
  return out;
}
