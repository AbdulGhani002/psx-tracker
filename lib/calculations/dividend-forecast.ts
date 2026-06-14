// Dividend forecast — earnings-grounded, driven by authoritative PSX payouts.
//
// Two data sources combine here:
//   • PSX payout history (declared cash dividends as % of face value, with their
//     cycle markers F/i/ii/iii and dates) — the truth about cadence and amounts.
//   • PSX financials (EPS per fiscal year) — the affordability anchor.
//
// The model:
//   1. Build per-symbol dividend history, preferring PSX payouts (DPS = % × face)
//      and falling back to your recorded dividends if PSX has none.
//   2. Group by Pakistan fiscal year. Cadence = the most payouts seen in any year
//      (so a quarterly payer reads quarterly even if PSX truncates older years).
//   3. "Declared" annual dividend = the most recent year that completed a cycle
//      (contains a Final). Payout ratio = that ÷ the earning year's EPS.
//   4. The forward, *sustainable* dividend is capped at earnings (≤100% payout) —
//      this is "what they can afford". Where a company pays above earnings (common
//      for holding companies funding from reserves) we flag it and still show the
//      declared figure.
//   5. Spread the forward dividend across the next 12 months on the company's own
//      payout months.
//
// All inputs are plain data, so the same function runs on the server and in tests.

import type { Transaction, Holding } from "@/lib/types";
import { taxYearOf } from "@/lib/dates";

const DAY = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY;
const DEFAULT_PAYOUT_RATIO_PCT = 60;
const MAX_SUSTAINABLE_PAYOUT_PCT = 100;

export type PayoutKind = "cash" | "bonus" | "right" | "other";

export type PayoutLite = {
  date: string | null; // ISO announcement date
  pctOfFace: number;
  cycle: string; // F | i | ii | iii | ""
  type: PayoutKind;
};

export type FundamentalsInput = {
  faceValue: number;
  latestEps: number | null;
  epsByYear: Record<number, number>; // fiscalYearEnd -> EPS
  epsGrowthPct: number | null;
  payouts?: PayoutLite[]; // authoritative PSX payouts (cash + non-cash)
};

export type FiscalYearDividend = {
  fyEndYear: number;
  label: string;
  dps: number;
  payments: number;
  hasFinal: boolean;
  pctOfFace: number;
  eps: number | null;
  payoutRatioPct: number | null;
  complete: boolean;
};

export type Cadence = "annual" | "semi-annual" | "quarterly" | "irregular";

export type SymbolDividendProfile = {
  symbol: string;
  name: string;
  shares: number;
  faceValue: number;
  faceValueSource: FaceValueSource;
  source: "psx" | "recorded";

  byFiscalYear: FiscalYearDividend[];
  cadence: Cadence;
  paymentsPerYear: number;

  latestEps: number | null;
  epsGrowthPct: number | null;
  dividendGrowthPct: number; // expected annual dividend growth (from EPS trend, clamped)
  medianPayoutRatioPct: number | null;
  overridden: boolean; // user pinned one or more values

  declaredAnnualDps: number; // what they actually declare in a full cycle (uncapped)
  forwardEps: number | null;
  appliedPayoutRatioPct: number | null;
  forwardDpsAnnual: number; // realistic, earnings-capped
  forwardDpsPctOfFace: number;
  forwardYieldPct: number | null;
  dividendCover: number | null;
  expectedAnnualIncome: number;
  aboveEarnings: boolean; // declared dividend exceeds EPS (paid from reserves)
  sustainability: "comfortable" | "stretched" | "at risk" | "above earnings" | "no dividend" | "unknown";
  basis: "earnings-capped" | "history-only" | "no-earnings-data";
  confidence: "high" | "medium" | "low";
  lastPaymentDate: Date | null;

  // Corporate actions
  hasSplit: boolean; // shares have been split (face value adjusted)
  recentBonusPct: number; // most recent fiscal year's total bonus %
  nextBonusDate: Date | null; // projected next bonus (anniversary), if recurring
  projectedBonusShares: number; // extra shares that bonus would add to your holding
};

export type BonusEvent = {
  symbol: string;
  name: string;
  date: Date;
  year: number;
  month: number;
  bonusPct: number;
  sharesAdded: number;
};

export type ForecastEvent = {
  symbol: string;
  name: string;
  date: Date;
  year: number;
  month: number;
  expectedRatePerShare: number;
  shares: number;
  expectedGross: number;
  basedOn: Date;
  confidence: "high" | "medium" | "low";
};

export type ForecastMonth = { year: number; month: number; label: string; total: number; events: ForecastEvent[] };

export type DividendForecast = {
  asOf: Date;
  windowEnd: Date;
  profiles: SymbolDividendProfile[];
  events: ForecastEvent[];
  months: ForecastMonth[];
  bonusEvents: BonusEvent[]; // projected bonus-share issues in the window
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
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
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
  prices?: Record<string, number>;
};

type HistItem = { date: Date; dps: number; isFinal: boolean };

// Cumulative share-multiplier from recorded SPLIT transactions. A "1:2" split
// (old:new) doubles the shares and halves the face value, so factor = new/old.
function splitFactorFor(symbol: string, transactions: Transaction[]): number {
  let factor = 1;
  for (const t of transactions) {
    if (t.symbol !== symbol || t.type !== "SPLIT") continue;
    const [from, to] = (t.ratio || "").split(":").map((s) => Number(s.trim()));
    if (from > 0 && to > 0) factor *= to / from;
  }
  return factor;
}

// PSX par values come in a few standard denominations. We snap noisy calibrated
// values to the nearest of these when they're within ~12%.
const STANDARD_FACES = [10, 5, 2, 1, 0.5];

function snapFace(v: number): number | null {
  for (const s of STANDARD_FACES) if (Math.abs(v - s) / s <= 0.12) return s;
  return null;
}

export type FaceValueSource = "calibrated" | "split-adjusted" | "assumed" | "override";

// Resolve the real face (par) value WITHOUT hardcoding. PSX dividends are a % of
// par, so par = (rupees you actually received) / (the % PSX declared). We match
// each recorded cash dividend to the nearest PSX payout and back out par, then
// snap to a standard denomination. Falls back to Rs 10 (split-adjusted) only
// when there's nothing to calibrate from.
function resolveFaceValue(
  recorded: { date: Date; ratePerShare: number }[],
  payouts: PayoutLite[] | undefined,
  splitFactor: number
): { faceValue: number; source: FaceValueSource } {
  const fallback = 10 / (splitFactor > 0 ? splitFactor : 1);
  const cash = (payouts ?? [])
    .filter((p) => p.type === "cash" && p.date && p.pctOfFace > 0)
    .map((p) => ({ date: new Date(p.date as string), pct: p.pctOfFace }))
    .filter((p) => !isNaN(p.date.getTime()));

  const implied: number[] = [];
  for (const r of recorded) {
    if (r.ratePerShare <= 0) continue;
    let best: { date: Date; pct: number } | null = null;
    let bestDiff = Infinity;
    for (const p of cash) {
      const d = Math.abs(p.date.getTime() - r.date.getTime());
      if (d < bestDiff) {
        bestDiff = d;
        best = p;
      }
    }
    if (best && bestDiff <= 150 * DAY) {
      const snapped = snapFace(r.ratePerShare / (best.pct / 100));
      if (snapped != null) implied.push(snapped);
    }
  }

  if (implied.length) {
    // Only trust calibration when the snapped values AGREE (a clear majority).
    // Conflicting values (often from messily-recorded amounts) fall back to the
    // standard rather than guessing wrong.
    const counts = new Map<number, number>();
    for (const f of implied) counts.set(f, (counts.get(f) ?? 0) + 1);
    let face = implied[0];
    let best = 0;
    for (const [f, n] of counts) if (n > best) { best = n; face = f; }
    if (best * 2 > implied.length) return { faceValue: face, source: "calibrated" };
  }

  return { faceValue: fallback, source: splitFactor !== 1 ? "split-adjusted" : "assumed" };
}

// Build dividend history for a symbol, preferring authoritative PSX payouts.
function historyFor(
  recorded: { date: Date; ratePerShare: number }[],
  fund: FundamentalsInput | undefined,
  face: number
): { items: HistItem[]; source: "psx" | "recorded" } {
  const cashPayouts = (fund?.payouts ?? []).filter((p) => p.type === "cash" && p.date && p.pctOfFace > 0);
  if (cashPayouts.length > 0) {
    const items = cashPayouts
      .map((p) => ({ date: new Date(p.date as string), dps: (p.pctOfFace / 100) * face, isFinal: p.cycle.toUpperCase() === "F" }))
      .filter((x) => !isNaN(x.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (items.length) return { items, source: "psx" };
  }
  const items = recorded
    .filter((r) => r.ratePerShare > 0 && !isNaN(r.date.getTime()))
    .map((r) => ({ date: r.date, dps: r.ratePerShare, isFinal: false }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return { items, source: "recorded" };
}

export function buildDividendProfiles(
  transactions: Transaction[],
  holdings: Holding[],
  opts: ForecastOptions = {}
): SymbolDividendProfile[] {
  const asOf = opts.asOf ?? new Date();
  const fundamentals = opts.fundamentals ?? {};
  const prices = opts.prices ?? {};
  const currentFyEnd = taxYearOf(asOf).endYear;

  const sharesBySymbol = new Map<string, { shares: number; name: string; override: any }>();
  for (const h of holdings) sharesBySymbol.set(h.symbol, { shares: h.currentShares, name: h.name || h.symbol, override: (h as any).dividendOverride ?? {} });

  const recordedBySymbol = new Map<string, { date: Date; ratePerShare: number }[]>();
  for (const t of transactions) {
    if (t.type !== "DIVIDEND") continue;
    const arr = recordedBySymbol.get(t.symbol) ?? [];
    arr.push({ date: asDate(t.date), ratePerShare: t.pricePerShare || 0 });
    recordedBySymbol.set(t.symbol, arr);
  }

  // Every held symbol that has either PSX payouts or recorded dividends.
  const symbols = new Set<string>([...recordedBySymbol.keys()]);
  for (const [sym, f] of Object.entries(fundamentals)) if ((f.payouts ?? []).some((p) => p.type === "cash")) symbols.add(sym);

  const profiles: SymbolDividendProfile[] = [];
  for (const symbol of symbols) {
    const held = sharesBySymbol.get(symbol);
    if (!held || held.shares <= 0) continue;

    const fund = fundamentals[symbol];
    const ov = held.override ?? {};
    const splitFactor = splitFactorFor(symbol, transactions);
    const recordedDivs = recordedBySymbol.get(symbol) ?? [];
    // Real par value, calibrated from your dividends — not hardcoded to Rs 10.
    let { faceValue, source: faceValueSource } = resolveFaceValue(recordedDivs, fund?.payouts, splitFactor);
    if (ov.parValue > 0) {
      faceValue = ov.parValue;
      faceValueSource = "override";
    }
    const price = prices[symbol] ?? 0;
    const { items, source } = historyFor(recordedDivs, fund, faceValue);
    if (items.length === 0) continue;

    // Group by fiscal year of the payment date.
    const fyMap = new Map<number, HistItem[]>();
    for (const it of items) {
      const fy = taxYearOf(it.date).endYear;
      const arr = fyMap.get(fy) ?? [];
      arr.push(it);
      fyMap.set(fy, arr);
    }

    const epsFor = (fy: number): number | null =>
      fund?.epsByYear?.[fy - 1] ?? fund?.epsByYear?.[fy] ?? null; // dividends pay from the prior fiscal year's earnings

    const byFiscalYear: FiscalYearDividend[] = [...fyMap.entries()]
      .map(([fyEndYear, its]) => {
        const dps = its.reduce((s, x) => s + x.dps, 0);
        const eps = epsFor(fyEndYear);
        return {
          fyEndYear,
          label: `FY${String(fyEndYear - 1).slice(2)}-${String(fyEndYear).slice(2)}`,
          dps,
          payments: its.length,
          hasFinal: its.some((x) => x.isFinal),
          pctOfFace: faceValue > 0 ? (dps / faceValue) * 100 : 0,
          eps,
          payoutRatioPct: eps != null && eps > 0 ? (dps / eps) * 100 : null,
          complete: fyEndYear < currentFyEnd,
        };
      })
      .sort((a, b) => b.fyEndYear - a.fyEndYear);

    // Cadence = the most payouts seen in any year (robust to truncated history).
    // A manual cadence override wins.
    const cadenceCounts: Record<string, number> = { annual: 1, "semi-annual": 2, quarterly: 4, irregular: 3 };
    let paymentsPerYear = Math.max(1, ...byFiscalYear.map((y) => y.payments));
    let cadence = cadenceFor(paymentsPerYear);
    if (ov.cadence && cadenceCounts[ov.cadence]) {
      cadence = ov.cadence as Cadence;
      paymentsPerYear = cadenceCounts[ov.cadence];
    }

    // Declared annual dividend = most recent year that completed a cycle (has a
    // Final); else the most recent complete fiscal year; else the latest year.
    const cycleYears = byFiscalYear.filter((y) => y.hasFinal);
    const completeYears = byFiscalYear.filter((y) => y.complete);
    const declaredYear = cycleYears[0] ?? completeYears[0] ?? byFiscalYear[0];
    const declaredAnnualDps = declaredYear?.dps ?? 0;

    const ratioYears = (cycleYears.length ? cycleYears : completeYears).filter((y) => y.payoutRatioPct != null);
    const medianPayoutRatioPct = median(ratioYears.map((y) => y.payoutRatioPct as number));

    const forwardEps = fund?.latestEps ?? null;
    let forwardDpsAnnual = 0;
    let appliedPayoutRatioPct: number | null = null;
    let basis: SymbolDividendProfile["basis"] = "no-earnings-data";

    if (forwardEps != null && forwardEps > 0) {
      const ratioPct = clamp(medianPayoutRatioPct ?? DEFAULT_PAYOUT_RATIO_PCT, 0, MAX_SUSTAINABLE_PAYOUT_PCT);
      appliedPayoutRatioPct = ratioPct;
      const earningsDps = forwardEps * (ratioPct / 100);
      forwardDpsAnnual = declaredAnnualDps > 0 ? Math.min(declaredAnnualDps, earningsDps) : earningsDps;
      basis = "earnings-capped";
    } else if (forwardEps != null && forwardEps <= 0) {
      forwardDpsAnnual = 0;
      basis = "earnings-capped";
    } else {
      forwardDpsAnnual = declaredAnnualDps;
      basis = "history-only";
    }

    // Manual overrides win over the model.
    if (ov.payoutRatioPct > 0 && forwardEps != null && forwardEps > 0) {
      appliedPayoutRatioPct = ov.payoutRatioPct;
      forwardDpsAnnual = forwardEps * (ov.payoutRatioPct / 100);
    }
    if (ov.expectedAnnualDps > 0) {
      forwardDpsAnnual = ov.expectedAnnualDps;
      appliedPayoutRatioPct = forwardEps != null && forwardEps > 0 ? (forwardDpsAnnual / forwardEps) * 100 : appliedPayoutRatioPct;
    }
    const overridden = !!(ov.parValue > 0 || ov.cadence || ov.payoutRatioPct > 0 || ov.expectedAnnualDps > 0);

    // Expected dividend growth from the EPS trend (clamped so a wild year doesn't
    // dominate). Feeds multi-year income projections.
    const dividendGrowthPct = clamp(fund?.epsGrowthPct ?? 0, -50, 30);

    const aboveEarnings = forwardEps != null && forwardEps > 0 && declaredAnnualDps > forwardEps + 1e-9;
    const dividendCover = forwardDpsAnnual > 0 && forwardEps != null ? forwardEps / forwardDpsAnnual : null;

    let sustainability: SymbolDividendProfile["sustainability"];
    if (forwardDpsAnnual <= 0) sustainability = forwardEps != null && forwardEps <= 0 ? "no dividend" : "unknown";
    else if (aboveEarnings) sustainability = "above earnings";
    else if (dividendCover == null) sustainability = "unknown";
    else if (dividendCover >= 2) sustainability = "comfortable";
    else if (dividendCover >= 1) sustainability = "stretched";
    else sustainability = "at risk";

    let confidence: SymbolDividendProfile["confidence"];
    if (source === "psx" && forwardEps != null) confidence = "high";
    else if (source === "psx" || forwardEps != null || completeYears.length >= 1) confidence = "medium";
    else confidence = "low";

    // --- Bonus shares ---------------------------------------------------------
    // PSX bonus issues grow your share count. Take the most recent fiscal year's
    // total bonus % and, if the company keeps issuing bonus, project the next one
    // a year on from the latest bonus date.
    const bonusItems = (fund?.payouts ?? [])
      .filter((p) => p.type === "bonus" && p.date && p.pctOfFace > 0)
      .map((p) => ({ date: new Date(p.date as string), pct: p.pctOfFace }))
      .filter((b) => !isNaN(b.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    let recentBonusPct = 0;
    let nextBonusDate: Date | null = null;
    if (bonusItems.length) {
      const lastBonus = bonusItems[bonusItems.length - 1];
      const lastBonusFy = taxYearOf(lastBonus.date).endYear;
      recentBonusPct = bonusItems.filter((b) => taxYearOf(b.date).endYear === lastBonusFy).reduce((s, b) => s + b.pct, 0);
      let cand = lastBonus.date;
      let guard = 0;
      while (cand.getTime() <= asOf.getTime() && guard < 12) {
        cand = addMonths(cand, 12);
        guard++;
      }
      if (cand.getTime() > asOf.getTime()) nextBonusDate = cand;
    }
    const projectedBonusShares = Math.floor(held.shares * (recentBonusPct / 100));

    profiles.push({
      symbol,
      name: held.name,
      shares: held.shares,
      faceValue,
      faceValueSource,
      source,
      byFiscalYear,
      cadence,
      paymentsPerYear,
      latestEps: forwardEps,
      epsGrowthPct: fund?.epsGrowthPct ?? null,
      dividendGrowthPct,
      medianPayoutRatioPct,
      overridden,
      declaredAnnualDps,
      forwardEps,
      appliedPayoutRatioPct,
      forwardDpsAnnual,
      forwardDpsPctOfFace: faceValue > 0 ? (forwardDpsAnnual / faceValue) * 100 : 0,
      forwardYieldPct: price > 0 ? (forwardDpsAnnual / price) * 100 : null,
      dividendCover,
      expectedAnnualIncome: forwardDpsAnnual * held.shares,
      aboveEarnings,
      sustainability,
      basis,
      confidence,
      lastPaymentDate: items[items.length - 1].date,
      hasSplit: splitFactor !== 1,
      recentBonusPct,
      nextBonusDate,
      projectedBonusShares,
    });
  }

  profiles.sort((a, b) => b.expectedAnnualIncome - a.expectedAnnualIncome);
  return profiles;
}

export function forecastDividends(
  transactions: Transaction[],
  holdings: Holding[],
  opts: ForecastOptions = {}
): DividendForecast {
  const asOf = opts.asOf ?? new Date();
  const fundamentals = opts.fundamentals ?? {};
  const profiles = buildDividendProfiles(transactions, holdings, opts);

  const gridStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const windowEnd = addMonths(gridStart, 12);
  const events: ForecastEvent[] = [];
  const bonusEvents: BonusEvent[] = [];

  // Recorded payments, for the fallback timing template.
  const recordedBySymbol = new Map<string, { date: Date; ratePerShare: number }[]>();
  for (const t of transactions) {
    if (t.type !== "DIVIDEND") continue;
    const arr = recordedBySymbol.get(t.symbol) ?? [];
    arr.push({ date: asDate(t.date), ratePerShare: t.pricePerShare || 0 });
    recordedBySymbol.set(t.symbol, arr);
  }

  for (const p of profiles) {
    // Projected bonus issue inside the window grows the share count.
    if (p.nextBonusDate && p.recentBonusPct > 0 && p.nextBonusDate < windowEnd) {
      bonusEvents.push({
        symbol: p.symbol,
        name: p.name,
        date: p.nextBonusDate,
        year: p.nextBonusDate.getUTCFullYear(),
        month: p.nextBonusDate.getUTCMonth(),
        bonusPct: p.recentBonusPct,
        sharesAdded: p.projectedBonusShares,
      });
    }

    if (p.forwardDpsAnnual <= 0) continue;
    const { items } = historyFor(recordedBySymbol.get(p.symbol) ?? [], fundamentals[p.symbol], p.faceValue);
    if (items.length === 0) continue;

    // Template = the payouts of the most recent fiscal year present (their
    // months + relative weights), so cadence and timing follow the company.
    const lastFy = taxYearOf(items[items.length - 1].date).endYear;
    let template = items.filter((x) => taxYearOf(x.date).endYear === lastFy);
    if (template.length === 0) template = [items[items.length - 1]];
    const templateTotal = template.reduce((s, x) => s + x.dps, 0) || 1;

    for (const t of template) {
      let candidate = t.date;
      let guard = 0;
      while (candidate.getTime() <= asOf.getTime() && guard < 12) {
        candidate = addMonths(candidate, 12);
        guard++;
      }
      if (candidate.getTime() <= asOf.getTime() || candidate.getTime() >= windowEnd.getTime()) continue;

      // A dividend paid after a projected bonus lands on the larger share count.
      const grownByBonus = p.nextBonusDate && candidate >= p.nextBonusDate ? 1 + p.recentBonusPct / 100 : 1;
      const shares = p.shares * grownByBonus;
      const ratePerShare = p.forwardDpsAnnual * (t.dps / templateTotal);
      const expectedGross = ratePerShare * shares;
      if (expectedGross <= 0) continue;

      events.push({
        symbol: p.symbol,
        name: p.name,
        date: candidate,
        year: candidate.getUTCFullYear(),
        month: candidate.getUTCMonth(),
        expectedRatePerShare: ratePerShare,
        shares,
        expectedGross,
        basedOn: t.date,
        confidence: p.confidence,
      });
    }
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  bonusEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

  const months: ForecastMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m = addMonths(gridStart, i);
    const year = m.getUTCFullYear();
    const month = m.getUTCMonth();
    const bucket = events.filter((e) => e.year === year && e.month === month);
    months.push({ year, month, label: monthLabel(year, month), total: bucket.reduce((s, e) => s + e.expectedGross, 0), events: bucket });
  }

  const total12m = events.reduce((s, e) => s + e.expectedGross, 0);
  const since = asOf.getTime() - YEAR_MS;
  const paidLast12m = transactions
    .filter((t) => t.type === "DIVIDEND" && asDate(t.date).getTime() >= since)
    .reduce((s, t) => s + (t.netAmount || 0), 0);

  return { asOf, windowEnd, profiles, events, months, bonusEvents, total12m, paidLast12m };
}
