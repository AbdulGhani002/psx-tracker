// Dividend forecast — earnings-grounded.
//
// The old model just repeated whatever per-share dividends you recorded in the
// trailing 365 days, times your shares. That over-projects badly: it ignores
// whether the company actually earns enough to pay that, and it mis-reads
// cadence when recorded payments straddle two fiscal years.
//
// This model instead asks "how much can they realistically pay?":
//   1. Group your recorded dividends by Pakistan fiscal year (Jul–Jun).
//   2. Read cadence from the modal number of payouts per *complete* fiscal year
//      (so an annual payer reads as annual even if a rolling year caught two).
//   3. Pull each company's EPS from PSX and express everything in % terms:
//      payout ratio (DPS / EPS), dividend as % of face value, dividend yield.
//   4. Forward annual dividend = forward EPS × a sustainable payout ratio
//      (the company's own historical median, capped at 100% — you can't keep
//      paying more than you earn). A loss-making year forecasts no dividend.
//   5. Spread that across the next 12 months following the historical cadence.
//
// All inputs are plain data, so the same function runs on the server and in
// tests.

import type { Transaction, Holding } from "@/lib/types";
import { taxYearOf } from "@/lib/dates";

const DAY = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY;
const DEFAULT_PAYOUT_RATIO_PCT = 60; // used only when earnings exist but history can't pin a ratio
const MAX_SUSTAINABLE_PAYOUT_PCT = 100; // can't sustainably pay out more than you earn

export type FundamentalsInput = {
  faceValue: number; // par value, usually Rs 10
  latestEps: number | null; // most recent annual EPS
  epsByYear: Record<number, number>; // fiscalYearEnd -> EPS
  epsGrowthPct: number | null;
};

export type DividendPayment = {
  date: Date;
  ratePerShare: number;
  gross: number;
};

export type FiscalYearDividend = {
  fyEndYear: number;
  label: string; // e.g. "FY24-25"
  dps: number; // total per-share for the year
  payments: number;
  pctOfFace: number; // dps / faceValue * 100
  eps: number | null;
  payoutRatioPct: number | null; // dps / eps * 100
  complete: boolean; // false for the current, still-running fiscal year
};

export type Cadence = "annual" | "semi-annual" | "quarterly" | "irregular";

export type SymbolDividendProfile = {
  symbol: string;
  name: string;
  shares: number;
  faceValue: number;

  byFiscalYear: FiscalYearDividend[]; // newest first
  cadence: Cadence;
  paymentsPerYear: number;

  // earnings
  latestEps: number | null;
  epsGrowthPct: number | null;
  medianPayoutRatioPct: number | null; // from complete years with positive EPS

  // forward, realistic estimate
  forwardEps: number | null;
  appliedPayoutRatioPct: number | null; // what we actually used
  typicalDps: number | null; // what they historically pay per year
  forwardDpsAnnual: number; // the realistic per-share dividend for the year
  forwardDpsPctOfFace: number;
  forwardYieldPct: number | null; // needs a price; null if unknown
  dividendCover: number | null; // EPS / DPS
  expectedAnnualIncome: number; // forwardDpsAnnual * shares
  sustainability: "comfortable" | "stretched" | "at risk" | "no dividend" | "unknown";
  basis: "earnings-capped" | "history-only" | "no-earnings-data";
  confidence: "high" | "medium" | "low";
  lastPaymentDate: Date | null;
};

export type ForecastEvent = {
  symbol: string;
  name: string;
  date: Date;
  year: number;
  month: number; // 0-11
  expectedRatePerShare: number;
  shares: number;
  expectedGross: number;
  basedOn: Date;
  confidence: "high" | "medium" | "low";
};

export type ForecastMonth = {
  year: number;
  month: number;
  label: string;
  total: number;
  events: ForecastEvent[];
};

export type DividendForecast = {
  asOf: Date;
  windowEnd: Date;
  profiles: SymbolDividendProfile[];
  events: ForecastEvent[];
  months: ForecastMonth[];
  total12m: number;
  paidLast12m: number;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

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

function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function cadenceFor(n: number): Cadence {
  if (n >= 4) return "quarterly";
  if (n === 3) return "irregular";
  if (n === 2) return "semi-annual";
  return "annual";
}

export type ForecastOptions = {
  asOf?: Date;
  fundamentals?: Record<string, FundamentalsInput>;
  prices?: Record<string, number>; // symbol -> current price, for yield
};

/**
 * Build the per-symbol dividend profile: fiscal-year history, cadence, earnings,
 * payout ratios, and a realistic forward annual dividend.
 */
export function buildDividendProfiles(
  transactions: Transaction[],
  holdings: Holding[],
  opts: ForecastOptions = {}
): SymbolDividendProfile[] {
  const asOf = opts.asOf ?? new Date();
  const fundamentals = opts.fundamentals ?? {};
  const prices = opts.prices ?? {};
  const currentFyEnd = taxYearOf(asOf).endYear;

  const sharesBySymbol = new Map<string, { shares: number; name: string }>();
  for (const h of holdings) sharesBySymbol.set(h.symbol, { shares: h.currentShares, name: h.name || h.symbol });

  const bySymbol = new Map<string, DividendPayment[]>();
  for (const t of transactions) {
    if (t.type !== "DIVIDEND") continue;
    const rate = t.pricePerShare || 0;
    if (rate <= 0 && (t.totalAmount || 0) <= 0) continue;
    const list = bySymbol.get(t.symbol) ?? [];
    list.push({ date: asDate(t.date), ratePerShare: rate, gross: t.totalAmount || 0 });
    bySymbol.set(t.symbol, list);
  }

  const profiles: SymbolDividendProfile[] = [];
  for (const [symbol, raw] of bySymbol) {
    const held = sharesBySymbol.get(symbol);
    if (!held || held.shares <= 0) continue;

    const payments = raw.filter((p) => !isNaN(p.date.getTime())).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (payments.length === 0) continue;

    const fund = fundamentals[symbol];
    const faceValue = fund?.faceValue ?? 10;
    const price = prices[symbol] ?? 0;

    // Group by Pakistan fiscal year.
    const fyMap = new Map<number, DividendPayment[]>();
    for (const p of payments) {
      const fy = taxYearOf(p.date).endYear;
      const arr = fyMap.get(fy) ?? [];
      arr.push(p);
      fyMap.set(fy, arr);
    }

    const byFiscalYear: FiscalYearDividend[] = [...fyMap.entries()]
      .map(([fyEndYear, ps]) => {
        const dps = ps.reduce((s, x) => s + x.ratePerShare, 0);
        const eps = fund?.epsByYear?.[fyEndYear] ?? null;
        return {
          fyEndYear,
          label: `FY${String(fyEndYear - 1).slice(2)}-${String(fyEndYear).slice(2)}`,
          dps,
          payments: ps.length,
          pctOfFace: faceValue > 0 ? (dps / faceValue) * 100 : 0,
          eps,
          payoutRatioPct: eps != null && eps > 0 ? (dps / eps) * 100 : null,
          complete: fyEndYear < currentFyEnd,
        };
      })
      .sort((a, b) => b.fyEndYear - a.fyEndYear);

    const completeYears = byFiscalYear.filter((y) => y.complete);
    const cadenceBasis = completeYears.length > 0 ? completeYears : byFiscalYear;

    // Cadence = modal payments-per-year across complete fiscal years.
    const countFreq = new Map<number, number>();
    for (const y of cadenceBasis) countFreq.set(y.payments, (countFreq.get(y.payments) ?? 0) + 1);
    let modalCount = 1;
    let best = -1;
    for (const [count, freq] of countFreq) {
      if (freq > best || (freq === best && count > modalCount)) {
        best = freq;
        modalCount = count;
      }
    }
    const paymentsPerYear = Math.max(1, modalCount);
    const cadence = cadenceFor(paymentsPerYear);

    // Payout ratios and typical DPS from complete years (fall back to all).
    const ratioYears = (completeYears.length ? completeYears : byFiscalYear).filter(
      (y) => y.payoutRatioPct != null && y.dps > 0
    );
    const medianPayoutRatioPct = median(ratioYears.map((y) => y.payoutRatioPct as number));
    const dpsYears = completeYears.length ? completeYears : byFiscalYear;
    const typicalDps = median(dpsYears.map((y) => y.dps));

    // Forward estimate.
    const forwardEps = fund?.latestEps ?? null;
    let forwardDpsAnnual = 0;
    let appliedPayoutRatioPct: number | null = null;
    let basis: SymbolDividendProfile["basis"] = "no-earnings-data";

    if (forwardEps != null && forwardEps > 0) {
      const ratioPct = clamp(medianPayoutRatioPct ?? DEFAULT_PAYOUT_RATIO_PCT, 0, MAX_SUSTAINABLE_PAYOUT_PCT);
      appliedPayoutRatioPct = ratioPct;
      const earningsDps = forwardEps * (ratioPct / 100);
      // Realistic = the lower of what they earn-room for and what they historically pay.
      forwardDpsAnnual = typicalDps != null ? Math.min(typicalDps, earningsDps) : earningsDps;
      basis = "earnings-capped";
    } else if (forwardEps != null && forwardEps <= 0) {
      forwardDpsAnnual = 0; // loss-making → no sustainable dividend
      basis = "earnings-capped";
    } else {
      // No earnings data at all — fall back to history, but stay conservative.
      forwardDpsAnnual = typicalDps ?? 0;
      basis = "history-only";
    }

    const dividendCover = forwardDpsAnnual > 0 && forwardEps != null ? forwardEps / forwardDpsAnnual : null;
    let sustainability: SymbolDividendProfile["sustainability"];
    if (forwardDpsAnnual <= 0) sustainability = forwardEps != null && forwardEps <= 0 ? "no dividend" : "unknown";
    else if (dividendCover == null) sustainability = "unknown";
    else if (dividendCover >= 2) sustainability = "comfortable";
    else if (dividendCover >= 1) sustainability = "stretched";
    else sustainability = "at risk";

    let confidence: SymbolDividendProfile["confidence"];
    if (completeYears.length >= 3 && forwardEps != null) confidence = "high";
    else if (completeYears.length >= 1 || forwardEps != null) confidence = "medium";
    else confidence = "low";

    profiles.push({
      symbol,
      name: held.name,
      shares: held.shares,
      faceValue,
      byFiscalYear,
      cadence,
      paymentsPerYear,
      latestEps: forwardEps,
      epsGrowthPct: fund?.epsGrowthPct ?? null,
      medianPayoutRatioPct,
      forwardEps,
      appliedPayoutRatioPct,
      typicalDps,
      forwardDpsAnnual,
      forwardDpsPctOfFace: faceValue > 0 ? (forwardDpsAnnual / faceValue) * 100 : 0,
      forwardYieldPct: price > 0 ? (forwardDpsAnnual / price) * 100 : null,
      dividendCover,
      expectedAnnualIncome: forwardDpsAnnual * held.shares,
      sustainability,
      basis,
      confidence,
      lastPaymentDate: payments[payments.length - 1].date,
    });
  }

  profiles.sort((a, b) => b.expectedAnnualIncome - a.expectedAnnualIncome);
  return profiles;
}

/**
 * Project the next 12 months of dividend cash. The forward annual dividend
 * (realistic, earnings-capped) is spread across the months the company
 * historically pays, following its cadence.
 */
export function forecastDividends(
  transactions: Transaction[],
  holdings: Holding[],
  opts: ForecastOptions = {}
): DividendForecast {
  const asOf = opts.asOf ?? new Date();
  const profiles = buildDividendProfiles(transactions, holdings, opts);

  const gridStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const windowEnd = addMonths(gridStart, 12);
  const events: ForecastEvent[] = [];

  // Raw payments per symbol, to find the historical payment months + weights.
  const paymentsBySymbol = new Map<string, DividendPayment[]>();
  for (const t of transactions) {
    if (t.type !== "DIVIDEND") continue;
    const rate = t.pricePerShare || 0;
    if (rate <= 0) continue;
    const arr = paymentsBySymbol.get(t.symbol) ?? [];
    arr.push({ date: asDate(t.date), ratePerShare: rate, gross: t.totalAmount || 0 });
    paymentsBySymbol.set(t.symbol, arr);
  }

  for (const p of profiles) {
    if (p.forwardDpsAnnual <= 0) continue;
    const raw = (paymentsBySymbol.get(p.symbol) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (raw.length === 0) continue;

    // Template = the payments of the most recent fiscal year present in history;
    // gives us how many payouts, in which months, and their relative sizes.
    const lastFy = taxYearOf(raw[raw.length - 1].date).endYear;
    let template = raw.filter((x) => taxYearOf(x.date).endYear === lastFy);
    if (template.length === 0) template = [raw[raw.length - 1]];
    const templateTotal = template.reduce((s, x) => s + x.ratePerShare, 0) || 1;

    for (const pay of template) {
      // Project this payment's month forward into the window.
      let candidate = pay.date;
      let guard = 0;
      while (candidate.getTime() <= asOf.getTime() && guard < 12) {
        candidate = addMonths(candidate, 12);
        guard++;
      }
      if (candidate.getTime() <= asOf.getTime() || candidate.getTime() >= windowEnd.getTime()) continue;

      // Scale this payment's share of the (new, sustainable) annual dividend.
      const ratePerShare = p.forwardDpsAnnual * (pay.ratePerShare / templateTotal);
      const expectedGross = ratePerShare * p.shares;
      if (expectedGross <= 0) continue;

      events.push({
        symbol: p.symbol,
        name: p.name,
        date: candidate,
        year: candidate.getUTCFullYear(),
        month: candidate.getUTCMonth(),
        expectedRatePerShare: ratePerShare,
        shares: p.shares,
        expectedGross,
        basedOn: pay.date,
        confidence: p.confidence,
      });
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

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
  const since = asOf.getTime() - YEAR_MS;
  const paidLast12m = transactions
    .filter((t) => t.type === "DIVIDEND" && asDate(t.date).getTime() >= since)
    .reduce((s, t) => s + (t.netAmount || 0), 0);

  return { asOf, windowEnd, profiles, events, months, total12m, paidLast12m };
}
