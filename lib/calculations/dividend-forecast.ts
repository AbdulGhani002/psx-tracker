// Dividend forecast calendar.
//
// Projects the cash you should receive from dividends over the next 12 months,
// using each symbol's own payout history. The model is deliberately simple and
// explainable: we look at the dividends a symbol actually paid in its most
// recent annual cycle and assume it repeats one year later at the same per-share
// rate. So a stock that paid four quarterly dividends last year yields four
// forecast events next year; an annual payer yields one. Amounts scale by the
// shares you currently hold.
//
// All inputs are plain data (transactions + holdings), so the same function
// works on the server (data layer) and in tests.

import type { Transaction, Holding } from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY;

export type DividendPayment = {
  date: Date;
  ratePerShare: number; // pricePerShare on a DIVIDEND transaction
  gross: number; // totalAmount
};

export type SymbolDividendProfile = {
  symbol: string;
  name: string;
  shares: number; // shares currently held
  payments: DividendPayment[]; // full history, oldest first
  lastPaymentDate: Date | null;
  yearsOfHistory: number;
  paymentsPerYear: number; // inferred cadence from the most recent cycle
  trailing12mRatePerShare: number; // sum of rate/share over the last 365 days of data
  inferredAnnualRatePerShare: number; // best estimate of forward annual rate/share
  confidence: "high" | "medium" | "low";
};

export type ForecastEvent = {
  symbol: string;
  name: string;
  date: Date; // projected payment date
  year: number;
  month: number; // 0-11
  expectedRatePerShare: number;
  shares: number;
  expectedGross: number;
  basedOn: Date; // the historical payment this projection repeats
  confidence: "high" | "medium" | "low";
};

export type ForecastMonth = {
  year: number;
  month: number; // 0-11
  label: string; // e.g. "Jul 2026"
  total: number;
  events: ForecastEvent[];
};

export type DividendForecast = {
  asOf: Date;
  windowEnd: Date;
  profiles: SymbolDividendProfile[]; // symbols held, with any dividend history
  events: ForecastEvent[]; // forward window, sorted by date
  months: ForecastMonth[]; // exactly 12 month buckets covering the window
  total12m: number;
  paidLast12m: number; // actual dividends received in the trailing 12 months (cash, net of tax/zakat)
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

// Add whole months in UTC, clamping the day so month-end / Feb-29 dates don't
// roll over into the next month (e.g. 31 Jan + 1m -> 28/29 Feb, not 2/3 Mar;
// 29 Feb + 12m -> 28 Feb, not 1 Mar).
function addMonths(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const r = new Date(d.getTime());
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/**
 * Build the per-symbol dividend profile from raw transactions and holdings.
 * Only symbols you currently hold (shares > 0) get a profile, since you can't
 * forecast income on a position you don't own.
 */
export function buildDividendProfiles(
  transactions: Transaction[],
  holdings: Holding[],
  asOf: Date = new Date()
): SymbolDividendProfile[] {
  const sharesBySymbol = new Map<string, { shares: number; name: string }>();
  for (const h of holdings) {
    sharesBySymbol.set(h.symbol, { shares: h.currentShares, name: h.name || h.symbol });
  }

  const bySymbol = new Map<string, DividendPayment[]>();
  for (const t of transactions) {
    if (t.type !== "DIVIDEND") continue;
    const rate = t.pricePerShare || 0;
    if (rate <= 0 && (t.totalAmount || 0) <= 0) continue; // skip empty rows
    const list = bySymbol.get(t.symbol) ?? [];
    list.push({ date: asDate(t.date), ratePerShare: rate, gross: t.totalAmount || 0 });
    bySymbol.set(t.symbol, list);
  }

  const profiles: SymbolDividendProfile[] = [];
  for (const [symbol, paymentsRaw] of bySymbol) {
    const held = sharesBySymbol.get(symbol);
    if (!held || held.shares <= 0) continue; // forecast only what you hold

    const payments = paymentsRaw
      .filter((p) => !isNaN(p.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (payments.length === 0) continue;

    const first = payments[0].date;
    const last = payments[payments.length - 1].date;
    const yearsOfHistory = Math.max(0, (last.getTime() - first.getTime()) / YEAR_MS);

    // Most recent annual cycle: payments within 365 days before the last one
    // (inclusive). This captures the cadence even if the last payment was a
    // while ago.
    const cycleStart = last.getTime() - YEAR_MS + DAY;
    const recentCycle = payments.filter((p) => p.date.getTime() >= cycleStart);
    const paymentsPerYear = Math.max(1, recentCycle.length);

    // Trailing-12-month rate, measured from the data's last payment so a stock
    // that paid recently still reports a sensible annual rate.
    const trailing12mRatePerShare = recentCycle.reduce((s, p) => s + p.ratePerShare, 0);
    const inferredAnnualRatePerShare = trailing12mRatePerShare;

    let confidence: SymbolDividendProfile["confidence"];
    if (yearsOfHistory >= 1.5 && payments.length >= paymentsPerYear * 2) confidence = "high";
    else if (yearsOfHistory >= 0.75 || payments.length >= 2) confidence = "medium";
    else confidence = "low";

    profiles.push({
      symbol,
      name: held.name,
      shares: held.shares,
      payments,
      lastPaymentDate: last,
      yearsOfHistory,
      paymentsPerYear,
      trailing12mRatePerShare,
      inferredAnnualRatePerShare,
      confidence,
    });
  }

  profiles.sort((a, b) => b.inferredAnnualRatePerShare * b.shares - a.inferredAnnualRatePerShare * a.shares);
  return profiles;
}

/**
 * Project the next 12 months of dividend cash. Each payment in the most recent
 * annual cycle is repeated forward (shifted by whole years until it lands in the
 * forward window), at the same per-share rate, scaled by current shares.
 */
export function forecastDividends(
  transactions: Transaction[],
  holdings: Holding[],
  asOf: Date = new Date()
): DividendForecast {
  const profiles = buildDividendProfiles(transactions, holdings, asOf);
  // The forecast window is exactly the 12 month buckets we render: from the
  // first day of the current month through the first day of the 13th month
  // (exclusive). Aligning the window to the bucket grid guarantees every kept
  // event lands in a bucket, so the month totals always sum to total12m.
  const gridStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const windowEnd = addMonths(gridStart, 12);
  const events: ForecastEvent[] = [];

  for (const p of profiles) {
    if (!p.lastPaymentDate) continue;
    const cycleStart = p.lastPaymentDate.getTime() - YEAR_MS + DAY;
    const recentCycle = p.payments.filter((x) => x.date.getTime() >= cycleStart);

    for (const pay of recentCycle) {
      // Shift this historical payment forward by whole years until it is after
      // "now" and inside the 12-month window.
      let candidate = pay.date;
      let guard = 0;
      while (candidate.getTime() <= asOf.getTime() && guard < 10) {
        candidate = addMonths(candidate, 12);
        guard++;
      }
      if (candidate.getTime() <= asOf.getTime()) continue;
      if (candidate.getTime() >= windowEnd.getTime()) continue;

      const expectedGross = pay.ratePerShare * p.shares;
      if (expectedGross <= 0) continue;

      events.push({
        symbol: p.symbol,
        name: p.name,
        date: candidate,
        year: candidate.getUTCFullYear(),
        month: candidate.getUTCMonth(),
        expectedRatePerShare: pay.ratePerShare,
        shares: p.shares,
        expectedGross,
        basedOn: pay.date,
        confidence: p.confidence,
      });
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Build 12 forward month buckets starting from the current month (UTC, so
  // bucket boundaries match how event months are derived above).
  const months: ForecastMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m = addMonths(gridStart, i);
    const year = m.getUTCFullYear();
    const month = m.getUTCMonth();
    const bucket = events.filter((e) => e.year === year && e.month === month);
    months.push({
      year,
      month,
      label: monthLabel(year, month),
      total: bucket.reduce((s, e) => s + e.expectedGross, 0),
      events: bucket,
    });
  }

  const total12m = events.reduce((s, e) => s + e.expectedGross, 0);

  // Actual dividend cash received in the trailing 12 months (net of tax/zakat).
  const since = asOf.getTime() - YEAR_MS;
  const paidLast12m = transactions
    .filter((t) => t.type === "DIVIDEND" && asDate(t.date).getTime() >= since)
    .reduce((s, t) => s + (t.netAmount || 0), 0);

  return { asOf, windowEnd, profiles, events, months, total12m, paidLast12m };
}
