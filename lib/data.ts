import "server-only";
import { cache } from "react";
import { connectDb } from "./db";
import { getCurrentUserId } from "./auth/current-user";
import { knownHoldingCompany } from "./holding-companies";
import { PmexAccountModel, HoldingModel, TransactionModel, CashEntryModel, WatchlistEntryModel, SbpRateModel, MutualFundModel, SavingsAccountModel, AppSettingsModel, CommodityTradeModel, FundamentalModel, FeedSnapshotModel, UserModel, DEFAULT_SETTINGS, type Holding, type Transaction } from "./models";
import { fetchFundamentals } from "./prices/fundamentals";
import { fetchPayouts } from "./prices/payouts";
import type { FundamentalsInput } from "./calculations/dividend-forecast";
import { SBP_POLICY_RATE_DEFAULTS, policyRateOn, type RateStep } from "./timeseries/sbp-rate";
import { fetchSbpRates, corridorAgrees, tbill12mPct, type SbpRates } from "./feeds/sbp";
import { fetchInflation, type InflationData } from "./feeds/inflation";

import { computeAttribution, type Attribution } from "./calculations/attribution";

import { fetchAllNavs, findNav, fetchFundReturns } from "./funds/mufap";
import { valueSavings, valueFund, type SavingsValuation, type FundValuation } from "./calculations/assets";

import { buildLots, previewSell, type Disposal, type CgtSummary } from "./calculations/lots";
import { computeRisk, type RiskMetrics } from "./calculations/risk";
import { computePSXFees } from "./calculations/fees";
import { valueTrade, expiryStatus, type TradeValuation } from "./calculations/pmex";
import { summarisePmex, fyWindow, financialYearOf, activeFinancialYears, type PmexSummary, type FyWindow } from "./calculations/pmex-summary";
import { getCommodityRef } from "./commodities/refs";
import { buildBenchmarkSeries } from "./timeseries/portfolio-history";
import { fetchEodSeries } from "./timeseries/psx-eod";
import { getPrices } from "./prices";
import { getPriceFreshness } from "./prices";
import { evaluateZone, sellableShares, zoneBuyFactor, distanceToZonePct, NO_ZONE_FACTOR, type ZoneEntry, type ZoneStatus } from "./calculations/zones";
import { planDeployment, type DeployCandidate, type DeployPlan } from "./calculations/deploy-plan";
import { resolveStandIn, validateLinks, type StandInGroup } from "./calculations/standin";
import { summarisePortfolio, computeCashBalance, summarisePmexAccount, type PortfolioSummary, type CashSummary, type PmexAccountSummary, type PmexMovement } from "./calculations";
import { forecastDividends, type DividendForecast } from "./calculations/dividend-forecast";
import { computeSotp, deriveSharesOutstanding, type SotpResult } from "./calculations/sotp";
import { computeIntrinsic, intrinsicSensitivity, normalizedEps, robustGrowthPct, sectorFairPE, type IntrinsicInputs, type IntrinsicResult, type Sensitivity } from "./calculations/intrinsic";
import { analyzeConcentration, analyzeCorrelation, type ConcentrationResult, type CorrelationResult } from "./calculations/risk-analysis";
import { fetchManyEod } from "./timeseries/psx-eod";
import { fetchMarketWatch, indexLabel, isInIndex } from "./prices/marketwatch";
import { taxYearOf } from "./dates";
import { type SectorComparison } from "./calculations/sector-weights";

function plain<T>(v: unknown): T {
  return JSON.parse(JSON.stringify(v));
}

// The current user's id, or a sentinel that matches no documents — so an
// unauthenticated/job-less context returns an empty result instead of leaking.
async function meId(): Promise<string> {
  return (await getCurrentUserId()) ?? "__no_user__";
}

export type DataAvailability = { available: true } | { available: false; reason: string };

let lastConnectionError: string | null = null;

async function tryConnect(): Promise<boolean> {
  try {
    await connectDb();
    lastConnectionError = null;
    return true;
  } catch (err) {
    lastConnectionError = String(err);
    return false;
  }
}

async function _checkDataAvailability(): Promise<DataAvailability> {
  const ok = await tryConnect();
  return ok ? { available: true } : { available: false, reason: lastConnectionError ?? "unknown" };
}

async function _getAllHoldings(): Promise<Holding[]> {
  const uid = await getCurrentUserId();
  if (!uid || !(await tryConnect())) return [];
  const docs = await HoldingModel.find({ userId: uid }).sort({ symbol: 1 }).lean();
  return plain<Holding[]>(docs);
}

export async function getHoldingBySymbol(symbol: string): Promise<Holding | null> {
  const uid = await getCurrentUserId();
  if (!uid || !(await tryConnect())) return null;
  const doc = await HoldingModel.findOne({ userId: uid, symbol: symbol.toUpperCase() }).lean();
  return doc ? plain<Holding>(doc) : null;
}

async function _getAllTransactions(): Promise<Transaction[]> {
  const uid = await getCurrentUserId();
  if (!uid || !(await tryConnect())) return [];
  const docs = await TransactionModel.find({ userId: uid, deletedAt: null }).sort({ date: -1, createdAt: -1 }).lean();
  return plain<Transaction[]>(docs);
}

export async function getTransactionsBySymbol(symbol: string): Promise<Transaction[]> {
  const uid = await getCurrentUserId();
  if (!uid || !(await tryConnect())) return [];
  const docs = await TransactionModel.find({ userId: uid, symbol: symbol.toUpperCase(), deletedAt: null })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  return plain<Transaction[]>(docs);
}

// Soft-deleted transactions only — powers the Trash view.
export async function getDeletedTransactions(): Promise<Transaction[]> {
  const uid = await getCurrentUserId();
  if (!uid || !(await tryConnect())) return [];
  const docs = await TransactionModel.find({ userId: uid, deletedAt: { $ne: null } })
    .sort({ deletedAt: -1 })
    .lean();
  return plain<Transaction[]>(docs);
}

export async function getCurrentPrices(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) return new Map();
  try {
    return await getPrices(symbols);
  } catch {
    return new Map();
  }
}

async function _getPortfolioSummary(): Promise<PortfolioSummary> {
  const [holdings, transactions] = await Promise.all([
    getAllHoldings(),
    getAllTransactions(),
  ]);
  const prices = await getCurrentPrices(holdings.map((h) => h.symbol));
  return summarisePortfolio({ holdings, transactions, prices });
}

const FUNDAMENTALS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // refresh weekly

// Cached company fundamentals, refreshing any that are missing or stale. Never
// throws — a symbol PSX can't serve is simply absent from the map, and the
// forecast falls back to history for it.
export async function getFundamentals(symbols: string[]): Promise<Record<string, FundamentalsInput>> {
  const out: Record<string, FundamentalsInput> = {};
  if (symbols.length === 0 || !(await tryConnect())) return out;
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];

  const cached = await FundamentalModel.find({ symbol: { $in: upper } }).lean();
  const bySym = new Map(cached.map((c: any) => [c.symbol, c]));
  const now = Date.now();

  const stale = upper.filter((s) => {
    const c = bySym.get(s);
    return !c || now - new Date(c.fetchedAt).getTime() > FUNDAMENTALS_TTL_MS;
  });

  if (stale.length) {
    await Promise.all(
      stale.map(async (s) => {
        // Financials (EPS) and payouts come from two PSX endpoints; fetch both.
        const [fresh, payouts] = await Promise.all([fetchFundamentals(s), fetchPayouts(s)]);
        if (!fresh && !payouts) return;
        const prev: any = bySym.get(s);
        const doc = await FundamentalModel.findOneAndUpdate(
          { symbol: s },
          {
            symbol: s,
            faceValue: fresh?.faceValue ?? prev?.faceValue ?? 10,
            sector: fresh?.sector || prev?.sector || "",
            annual: fresh?.annual ?? prev?.annual ?? [],
            latestEps: fresh?.latestEps ?? prev?.latestEps ?? null,
            epsGrowthPct: fresh?.epsGrowthPct ?? prev?.epsGrowthPct ?? null,
            latestNetMarginPct: fresh?.latestNetMarginPct ?? prev?.latestNetMarginPct ?? null,
            marginTrendPct: fresh?.marginTrendPct ?? prev?.marginTrendPct ?? null,
            revenueGrowthPct: fresh?.revenueGrowthPct ?? prev?.revenueGrowthPct ?? null,
            peTtm: fresh?.peTtm ?? prev?.peTtm ?? null,
            pegTtm: fresh?.pegTtm ?? prev?.pegTtm ?? null,
            sharesOutstanding: fresh?.sharesOutstanding ?? prev?.sharesOutstanding ?? null,
            marketCapThousands: fresh?.marketCapThousands ?? prev?.marketCapThousands ?? null,
            payouts: payouts != null
              ? payouts.map((p) => ({ date: p.announceDate ?? p.bookClosureStart, bookClosure: p.bookClosureStart, pctOfFace: p.pctOfFace, cycle: p.cycle, payoutType: p.payoutType }))
              : prev?.payouts ?? [],
            source: fresh?.source ?? "psx-dps",
            fetchedAt: new Date(),
          },
          { upsert: true, new: true }
        ).lean();
        if (doc) bySym.set(s, doc);
      })
    );
  }

  for (const s of upper) {
    const c: any = bySym.get(s);
    if (!c) continue;
    const epsByYear: Record<number, number> = {};
    for (const a of c.annual ?? []) if (a.eps != null) epsByYear[a.fiscalYear] = a.eps;
    out[s] = {
      faceValue: c.faceValue ?? 10,
      latestEps: c.latestEps ?? null,
      epsByYear,
      epsGrowthPct: c.epsGrowthPct ?? null,
      latestNetMarginPct: c.latestNetMarginPct ?? null,
      marginTrendPct: c.marginTrendPct ?? null,
      revenueGrowthPct: c.revenueGrowthPct ?? null,
      peTtm: c.peTtm ?? null,
      sharesOutstanding: c.sharesOutstanding ?? null,
      payouts: (c.payouts ?? []).map((p: any) => ({
        date: p.date ?? null,
        pctOfFace: p.pctOfFace,
        cycle: p.cycle ?? "",
        type: (p.payoutType ?? (p.isCash === false ? "other" : "cash")) as "cash" | "bonus" | "right" | "other",
      })),
    };
  }
  return out;
}

// Upcoming ex-dividend / book-closure dates for held symbols (next `days` days),
// from the cached PSX payouts. Powers the ex-dividend Telegram alert.
export async function getUpcomingExDates(days = 14): Promise<Array<{ symbol: string; date: string; pctOfFace: number; faceValue: number }>> {
  if (!(await tryConnect())) return [];
  const holdings = await HoldingModel.find({ userId: await meId(), currentShares: { $gt: 0 } }).lean();
  const syms = holdings.map((h: any) => h.symbol);
  if (!syms.length) return [];
  const funds: any[] = await FundamentalModel.find({ symbol: { $in: syms } }).lean();
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const out: Array<{ symbol: string; date: string; pctOfFace: number; faceValue: number }> = [];
  for (const f of funds) {
    for (const p of f.payouts ?? []) {
      const bc = p.bookClosure;
      if (p.payoutType === "cash" && bc && bc >= today && bc <= end) {
        out.push({ symbol: f.symbol, date: bc, pctOfFace: p.pctOfFace, faceValue: f.faceValue ?? 10 });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getDividendForecast(): Promise<DividendForecast> {
  const [holdings, transactions] = await Promise.all([getAllHoldings(), getAllTransactions()]);
  const held = holdings.filter((h) => h.currentShares > 0).map((h) => h.symbol);
  const [prices, fundamentals] = await Promise.all([getCurrentPrices(held), getFundamentals(held)]);
  const priceMap: Record<string, number> = {};
  for (const [k, v] of prices) priceMap[k] = v;
  return forecastDividends(transactions, holdings, { fundamentals, prices: priceMap });
}

// Valuation across all held stocks. EPS from cached fundamentals, forward
// dividend + growth from the forecast, book value from the (editable) holding
// field, required return from the live SBP rate + your equity-premium setting.
// (the old single-method valuation engine lived here — superseded by
// computeIntrinsic/getIntrinsicValuations, which is now the ONLY fair value.)
export type IntrinsicView = IntrinsicResult & {
  name: string;
  shares: number;
  marketValue: number;
  annualVolPct: number | null;
  epsLatest: number | null;
  epsNormalized: number | null;
  sensitivity: Sensitivity[];
  history: { date: string; close: number }[]; // downsampled EOD for the zone chart
  inputs: IntrinsicInputs; // raw inputs so the page can re-run the model live
};

export type IntrinsicPage = {
  items: IntrinsicView[];
  requiredReturnPct: number;
  sbpRatePct: number;
  equityRiskPremiumPct: number;
  fairPE: number;
};

// Annualised volatility (%) from a daily close series — the stock's own risk,
// used to scale how big a margin of safety we demand.
function annualisedVol(series: { close: number }[]): number | null {
  const closes = series.map((p) => p.close).filter((c) => c > 0);
  if (closes.length < 30) return null;
  const recent = closes.slice(-250); // ~1 trading year
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) rets.push(recent[i] / recent[i - 1] - 1);
  if (rets.length < 20) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// Keep the chart light: take ~1 year and stride down to <=140 points.
function downsample(series: { date: string; close: number }[], target = 140): { date: string; close: number }[] {
  const year = series.slice(-252);
  if (year.length <= target) return year;
  const stride = Math.ceil(year.length / target);
  const out = year.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== year[year.length - 1]) out.push(year[year.length - 1]);
  return out;
}

// Intrinsic value, valuation methods, buying zones, sensitivity and a price
// history for every holding. Heavy (EOD per symbol) → cached + cron-warmed.
async function _getIntrinsicValuations(): Promise<IntrinsicPage> {
  return cachedSnapshot("page:intrinsic", 90 * 60 * 1000, computeIntrinsicValuations);
}

async function computeIntrinsicValuations(): Promise<IntrinsicPage> {
  const [holdings, settings, sbp] = await Promise.all([getAllHoldings(), getAppSettings(), getSbpRateSteps()]);
  const held = holdings.filter((h) => h.currentShares > 0);
  const fairPE = (settings as any).defaultFairPE ?? 8;
  const equityRiskPremiumPct = (settings as any).equityRiskPremiumPct ?? 6;
  const sbpRatePct = policyRateOn(new Date().toISOString().slice(0, 10), sbp.steps) ?? 11;
  const requiredReturnPct = sbpRatePct + equityRiskPremiumPct;
  if (!held.length) return { items: [], requiredReturnPct, sbpRatePct, equityRiskPremiumPct, fairPE };

  const syms = held.map((h) => h.symbol);
  const [prices, funds, forecast, eod] = await Promise.all([
    getCurrentPrices(syms),
    getFundamentals(syms),
    getDividendForecast(),
    fetchManyEod(syms).catch(() => new Map()),
  ]);
  const profBySym = new Map(forecast.profiles.map((p) => [p.symbol, p]));

  // Each share's own beta — so the required return is per-company, not one flat
  // hurdle for a utility and a cyclical alike. Cached + shared across the loop.
  const betaMap = await getBetaMap();

  // Look-through NAV for holding companies (top-level only — fast).
  const lookThroughs = new Map<string, LookThrough>();
  await Promise.all(
    held
      .filter((h) => (h as any).lookThrough?.enabled)
      .map(async (h) => {
        const lt = await getLookThroughFor(h.symbol, { skipChildren: true }).catch(() => null);
        if (lt && lt.navPerShare > 0) lookThroughs.set(h.symbol, lt);
      })
  );

  const items: IntrinsicView[] = held
    .map((h) => {
      const price = prices.get(h.symbol) ?? 0;
      const eps = funds[h.symbol]?.latestEps ?? null;
      const prof = profBySym.get(h.symbol);
      const series = (eod.get(h.symbol) as { date: string; close: number }[] | undefined) ?? [];
      const annualVolPct = annualisedVol(series);

      // Through-cycle earning power + multi-year growth from the EPS history, so
      // one freak year can't distort the value (this was the MEBL problem).
      const epsByYear = (funds[h.symbol]?.epsByYear ?? {}) as Record<number, number>;
      const epsAsc = Object.keys(epsByYear)
        .map(Number)
        .sort((a, b) => a - b)
        .map((y) => Number(epsByYear[y]))
        .filter((e) => Number.isFinite(e));
      const sector = (h as any).sector ?? "";
      const fdata = funds[h.symbol];
      const marginTrend = fdata?.marginTrendPct ?? null;

      // Earning power = a blend of CURRENT (TTM) earnings and the through-cycle
      // 3-yr average. The 3-yr average alone lags reality — it missed LUCK's
      // earnings collapse and PTL's recovery. PSX's trailing P/E gives the TTM
      // EPS (price ÷ P/E); we lean on it (60%) but floor it to the through-cycle
      // number (40%, clamped to 0.4–2× of it) so a one-off spike can't dominate.
      const throughCycle = normalizedEps(epsAsc) ?? eps;
      const ttmEps = fdata?.peTtm != null && fdata.peTtm > 0 && price > 0 ? price / fdata.peTtm : null;
      let epsNorm = throughCycle;
      if (ttmEps != null && throughCycle != null && throughCycle > 0) {
        const cappedTtm = Math.max(0.4 * throughCycle, Math.min(2.0 * throughCycle, ttmEps));
        epsNorm = 0.6 * cappedTtm + 0.4 * throughCycle;
      }
      const rawGrowth = epsAsc.length >= 2 ? robustGrowthPct(epsAsc) : prof?.dividendGrowthPct ?? funds[h.symbol]?.epsGrowthPct ?? 0;
      // Fade the trailing growth: windfall years (e.g. banks at 22% rates) don't
      // persist, so we credit ~60% of it, capped — standard "growth fades" practice.
      const growth = Math.max(-8, Math.min(15, rawGrowth * 0.6));
      // Sector-aware fair P/E: a brewery monopoly, a bank and a power utility get
      // very different multiples. Uses this stock's PSX sector + growth + margin
      // trend + the rate.
      const holdingFairPE = sectorFairPE(sector, growth, sbpRatePct, marginTrend ?? 0);

      const inputs: IntrinsicInputs = {
        symbol: h.symbol,
        price,
        eps,
        normalizedEps: epsNorm,
        epsGrowthPct: growth,
        forwardDps: prof?.forwardDpsAnnual ?? 0,
        dividendGrowthPct: growth,
        sbpRatePct,
        equityRiskPremiumPct,
        fairPE: holdingFairPE,
        aboveEarnings: prof?.aboveEarnings ?? false,
        annualVolPct,
        navPerShare: lookThroughs.get(h.symbol)?.navPerShare ?? null,
        // The company's own audited fair-value assumptions, if we've recorded
        // them from its accounts. Only pass a model that is actually filled in —
        // a zeroed subdoc must stay null so the method reads "not applicable"
        // rather than valuing the share at zero.
        betaRaw: betaMap.get(h.symbol.toUpperCase()) ?? null,
        disclosed: (() => {
          const d = (h as any).disclosedValuation;
          if (!d || !(d.baseDps > 0) || !(d.requiredReturnPct > 0)) return null;
          return {
            requiredReturnPct: d.requiredReturnPct,
            growthPct: d.growthPct ?? 0,
            baseDps: d.baseDps,
            source: d.source ?? "",
            asOf: d.asOf ?? "",
          };
        })(),
        sector,
        netMarginPct: fdata?.latestNetMarginPct ?? null,
        marginTrendPct: marginTrend,
        revenueGrowthPct: fdata?.revenueGrowthPct ?? null,
        peTtm: fdata?.peTtm ?? null,
        // Book value was being STORED and never read. For a bank it is the
        // anchor the whole valuation hangs off, so without it the engine was
        // reaching for earnings models that do not apply to one.
        bookValuePerShare: (h as any).bookValuePerShare > 0 ? (h as any).bookValuePerShare : null,
        // What the company actually pays out, derived from the forward dividend
        // against through-cycle earning power. Retention is what funds a bank's
        // book growth, so a guessed payout would guess the growth with it.
        payoutRatio:
          prof?.forwardDpsAnnual != null && epsNorm != null && epsNorm > 0
            ? Math.max(0, Math.min(1, prof.forwardDpsAnnual / epsNorm))
            : null,
      };
      const result = computeIntrinsic(inputs);
      return {
        ...result,
        name: h.name,
        shares: h.currentShares,
        marketValue: price * h.currentShares,
        annualVolPct,
        epsLatest: eps,
        epsNormalized: epsNorm,
        sensitivity: intrinsicSensitivity(inputs),
        history: downsample(series),
        inputs,
      };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  return { items, requiredReturnPct, sbpRatePct, equityRiskPremiumPct, fairPE };
}

export type RiskAnalysis = {
  concentration: ConcentrationResult;
  correlation: CorrelationResult;
  stressBase: { equity: number; funds: number; savings: number; cash: number };
  safeRatePct: number;
  concentrationCap: number;
};

// Concentration + correlation + the base figures for the (client-side) stress
// test. Correlation uses EOD price series per holding.
export async function getRiskAnalysis(): Promise<RiskAnalysis> {
  return cachedSnapshot("page:riskAnalysis", 90 * 60 * 1000, computeRiskAnalysis);
}

async function computeRiskAnalysis(): Promise<RiskAnalysis> {
  const [summary, nw, settings] = await Promise.all([getPortfolioSummary(), getNetWorth().catch(() => null), getAppSettings()]);
  const cap = (settings as any).concentrationCap ?? 25;
  const positions = summary.positions
    .filter((p) => p.marketValue > 0)
    .map((p) => ({ symbol: p.symbol, sector: p.sector, marketValue: p.marketValue }));
  const concentration = analyzeConcentration(positions, cap);

  let correlation: CorrelationResult = { symbols: [], matrix: [], avgPairwise: null, mostCorrelated: null };
  try {
    const symbols = positions.map((p) => p.symbol);
    if (symbols.length >= 2) {
      const eod = await fetchManyEod(symbols);
      const series = [...eod.entries()].map(([symbol, points]) => ({ symbol, points: points.map((p) => ({ date: p.date, close: p.close })) }));
      correlation = analyzeCorrelation(series);
    }
  } catch {
    /* correlation is best-effort */
  }

  const stressBase = {
    equity: (nw as any)?.equity ?? summary.totalValue ?? 0,
    funds: (nw as any)?.funds ?? 0,
    savings: (nw as any)?.savings ?? 0,
    // Brokerage cash is not part of net worth — see _getNetWorth. Stated as an
    // explicit zero rather than an absent field, so the stress test is not
    // quietly reading `undefined` off a type that no longer carries it.
    cash: 0,
  };

  return { concentration, correlation, stressBase, safeRatePct: 3, concentrationCap: cap };
}

// --- Precomputed feed snapshots ---------------------------------------------
// Heavy datasets (e.g. KSE-100 sector weights) are computed by a background cron
// and stored as a single latest document per key, so the UI reads them
// instantly instead of recomputing on every page load.

export type FeedSnapshotMeta<T> = {
  data: T | null;
  status: string; // ok | error | building | missing
  note: string;
  updatedAt: string | null; // ISO
};

export async function getFeedSnapshot<T = unknown>(key: string): Promise<FeedSnapshotMeta<T>> {
  if (!(await tryConnect())) return { data: null, status: "missing", note: "no db", updatedAt: null };
  const doc: any = await FeedSnapshotModel.findOne({ key }).lean();
  if (!doc) return { data: null, status: "missing", note: "", updatedAt: null };
  return {
    data: doc.data ? plain<T>(doc.data) : null,
    status: doc.status ?? "ok",
    note: doc.note ?? "",
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

// Pass data = null/undefined to update only status/note (e.g. on a failed run),
// preserving the last good payload so the UI keeps showing it.
export async function saveFeedSnapshot(key: string, data: unknown, status = "ok", note = ""): Promise<void> {
  if (!(await tryConnect())) return;
  const set: Record<string, unknown> = { key, status, note, updatedAt: new Date() };
  if (data != null) set.data = data;
  await FeedSnapshotModel.findOneAndUpdate({ key }, set, { upsert: true });
}

// Read-through cache for an expensive aggregate: serve a fresh stored snapshot
// instantly, recompute when stale (storing the new one), and on a compute
// failure fall back to the last good snapshot. Keeps slow pages (valuation,
// dashboard) fast even on a cold load. The snapshot cron pre-warms these keys.
export async function cachedSnapshot<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  // Per-user cache key so one account's heavy aggregates never serve another's.
  const uid = await getCurrentUserId();
  key = uid ? `${key}:${uid}` : key;
  const cached = await getFeedSnapshot<T>(key);
  const fresh = cached.data != null && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < ttlMs;
  if (fresh) return cached.data as T;
  try {
    const result = await compute();
    await saveFeedSnapshot(key, result as unknown, "ok").catch(() => {});
    return result;
  } catch (e) {
    if (cached.data != null) return cached.data as T; // stale-but-shown beats an error
    throw e;
  }
}

// Warm the current user's expensive page aggregates. Runs inside a
// runAsUser(...) scope on the cron, so the getters cache under per-user keys.
export async function warmPageCaches(): Promise<Record<string, string>> {
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ["intrinsic", getIntrinsicValuations],
    ["riskMetrics", getRiskMetrics],
    ["riskAnalysis", getRiskAnalysis],
    ["todaysMovers", getTodaysMovers],
    ["shariah", getShariahStatus],
  ];
  const out: Record<string, string> = {};
  for (const [name, fn] of jobs) {
    try {
      await fn();
      out[name] = "ok";
    } catch (e) {
      out[name] = "error: " + String(e).slice(0, 60);
    }
  }
  return out;
}

// Every user id — the cron loops these to warm each account's caches.
export async function getAllUserIds(): Promise<string[]> {
  if (!(await tryConnect())) return [];
  const docs = await UserModel.find({}, { _id: 1 }).lean();
  return docs.map((u: any) => String(u._id));
}

export type SectorComparisonResult = {
  comparison: SectorComparison[];
  index: string;
  asOf: string | null; // when the index snapshot was built
  updatedAt: string | null; // when it was stored
  status: string;
  note: string;
  membersPriced: number;
  membersTotal: number;
  yourEquityValue: number;
};

export type LookThrough = SotpResult & { symbol: string; name: string; children?: LookThrough[]; partial?: boolean };

// Look-through (sum-of-the-parts) valuation for a single holding company.
// Stakes are from the holding config; constituent + own prices are live;
// shares outstanding derives from financials when not pinned. Recurses one extra
// level: any listed constituent that is itself a configured holding company
// (e.g. AHL inside AHCL) is drilled into and attached as a child for analysis.
export async function getLookThroughFor(
  symbol: string,
  opts?: { depth?: number; visited?: Set<string>; skipChildren?: boolean }
): Promise<LookThrough | null> {
  if (!(await tryConnect())) return null;
  const depth = opts?.depth ?? 0;
  const visited = opts?.visited ?? new Set<string>();
  const sym = symbol.toUpperCase();
  const h: any = await HoldingModel.findOne({ userId: await meId(), symbol: sym }).lean();
  const lt = h?.lookThrough;
  const dbEnabled = !!lt?.enabled && ((lt.constituents?.length > 0) || (lt.unlistedHoldings?.length > 0));

  // Config from the holding's own look-through if enabled; otherwise fall back
  // to the known-companies library so SUB-holdings (e.g. Fatima inside AHCL)
  // drill down without needing a phantom holding row in your portfolio.
  const known = knownHoldingCompany(sym);
  type Cfg = {
    constituents: Array<{ label: string; symbol: string; shares: number; ownershipPct?: number }>;
    unlistedHoldings: Array<{ label: string; valuePkr: number; ownershipPct?: number; note?: string }>;
    unlistedValuePkr: number;
    netDebtPkr: number;
    sharesOutstanding: number;
    name: string;
    heldShares: number;
  };
  let cfg: Cfg;
  if (dbEnabled) {
    cfg = {
      constituents: lt.constituents ?? [],
      unlistedHoldings: (lt.unlistedHoldings ?? []).map((u: any) => ({ label: u.label, valuePkr: u.valuePkr ?? 0, ownershipPct: u.ownershipPct ?? 0, note: u.note ?? "" })),
      unlistedValuePkr: lt.unlistedValuePkr ?? 0,
      netDebtPkr: lt.netDebtPkr ?? 0,
      sharesOutstanding: lt.sharesOutstanding ?? 0,
      name: h?.name ?? sym,
      heldShares: h?.currentShares ?? 0,
    };
  } else if (known && (known.listed.length > 0 || known.unlisted.length > 0)) {
    cfg = {
      constituents: known.listed.map((k) => ({ label: k.label, symbol: k.symbol, shares: 0, ownershipPct: k.ownershipPct })),
      unlistedHoldings: known.unlisted.map((u) => ({ label: u.label, valuePkr: u.valuePkr ?? 0, ownershipPct: u.ownershipPct ?? 0, note: u.note })),
      unlistedValuePkr: 0,
      netDebtPkr: 0,
      sharesOutstanding: known.sharesOutstanding ?? 0,
      name: h?.name ?? known.name,
      heldShares: h?.currentShares ?? 0,
    };
  } else {
    return null;
  }

  const constituents = cfg.constituents.filter((c) => c.symbol);
  const conSyms = constituents.map((c) => c.symbol.toUpperCase());
  const symbols = [...new Set([sym, ...conSyms])];
  const prices = await getCurrentPrices(symbols);
  const priceObj: Record<string, number> = {};
  for (const [k, v] of prices) priceObj[k] = v;

  // Total shares outstanding for the holding co + any constituent given as an
  // ownership %, derived from each company's financials (cached, fetched if new).
  const needShares = [sym, ...constituents.filter((c) => (c.ownershipPct ?? 0) > 0).map((c) => c.symbol.toUpperCase())];
  await getFundamentals(needShares); // ensure cached
  const fundDocs: any[] = await FundamentalModel.find({ symbol: { $in: [...new Set(needShares)] } }).lean();
  const sharesOutMap = new Map<string, number>();
  for (const f of fundDocs) {
    const latest = f.annual?.[0];
    sharesOutMap.set(f.symbol, deriveSharesOutstanding(latest?.profitAfterTax ?? null, latest?.eps ?? null));
  }

  let shares = cfg.sharesOutstanding || 0;
  if (shares <= 0) shares = sharesOutMap.get(sym) ?? 0;

  const resolvedConstituents = constituents.map((c) => {
    const cs = c.symbol.toUpperCase();
    const ownedShares = (c.ownershipPct ?? 0) > 0 ? ((c.ownershipPct as number) / 100) * (sharesOutMap.get(cs) ?? 0) : c.shares;
    return { label: c.label || cs, symbol: cs, shares: ownedShares };
  });

  const result = computeSotp({
    constituents: resolvedConstituents,
    prices: priceObj,
    unlistedHoldings: cfg.unlistedHoldings,
    unlistedValuePkr: cfg.unlistedValuePkr,
    netDebtPkr: cfg.netDebtPkr,
    sharesOutstanding: shares,
    marketPrice: prices.get(sym) ?? 0,
    heldShares: cfg.heldShares,
  });

  const base: LookThrough = { symbol: sym, name: cfg.name, ...result };
  if (known?.investmentsOnly) base.partial = true; // operating co: holdings ≠ NAV

  // Recurse: drill into any listed constituent that is itself a configured
  // holding company (e.g. AHL inside AHCL). getLookThroughFor returns null for
  // ordinary operating companies, so only true sub-holdings attach. Depth + a
  // visited set guard against cycles and runaway recursion.
  if (depth < 2 && !opts?.skipChildren) {
    visited.add(sym);
    const children: LookThrough[] = [];
    for (const c of result.constituents) {
      const cs = c.symbol.toUpperCase();
      if (visited.has(cs)) continue;
      const child = await getLookThroughFor(cs, { depth: depth + 1, visited });
      if (child) children.push(child);
    }
    if (children.length) base.children = children;
  }

  return base;
}

export type MarketContext = {
  symbol: string;
  price: number;
  week52High: number | null;
  week52Low: number | null;
  positionPct: number | null; // where price sits in the 52-week range
  indices: string[]; // indices this symbol belongs to
};

// Derived market context for a symbol: 52-week range from EOD history + index
// membership from PSX market-watch. All from free PSX data, no paid feed.
export type ShariahHolding = {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  marketValue: number;
  inKmi30: boolean;
  inKmiAllShare: boolean;
  compliant: boolean | null; // null = unknown (symbol not in market-watch feed)
  dividendThisYear: number;
  purificationPct: number;
  purificationDue: number;
};

// Shariah view: tag each holding by KMI index membership (the KMI All-Share /
// KMI-30 indices are Meezan-screened, so membership ≈ currently compliant), and
// compute the purification (charity) due from this year's dividends using the
// non-permissible income % you enter per holding.
export async function getShariahStatus(): Promise<{
  holdings: ShariahHolding[];
  compliantValue: number;
  nonCompliantValue: number;
  unknownValue: number;
  totalValue: number;
  totalPurification: number;
  taxYearLabel: string;
}> {
  return cachedSnapshot("page:shariah", 90 * 60 * 1000, computeShariahStatus);
}

async function computeShariahStatus() {
  const [summary, holdings, txs, mw] = await Promise.all([
    getPortfolioSummary(),
    getAllHoldings(),
    getAllTransactions(),
    fetchMarketWatch().catch(() => null),
  ]);
  const nameBySym = new Map(holdings.map((h: any) => [h.symbol, h.name]));
  const purifBySym = new Map(holdings.map((h: any) => [h.symbol, h.purificationPctOfDividend ?? 0]));
  const ty = taxYearOf(new Date().toISOString().slice(0, 10));
  const divBySym = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== "DIVIDEND") continue;
    if (taxYearOf(new Date(t.date).toISOString().slice(0, 10)).endYear !== ty.endYear) continue;
    divBySym.set(t.symbol, (divBySym.get(t.symbol) ?? 0) + (t.netAmount ?? 0));
  }

  const active = summary.positions.filter((p) => p.shares > 0);
  const out: ShariahHolding[] = active.map((p) => {
    const row = mw?.get(p.symbol);
    const inKmi30 = row ? isInIndex(row, "KMI30") : false;
    const inKmiAll = row ? isInIndex(row, "KMIALLSHR") : false;
    const compliant = row ? inKmi30 || inKmiAll : null;
    const purificationPct = purifBySym.get(p.symbol) ?? 0;
    const dividendThisYear = divBySym.get(p.symbol) ?? 0;
    return {
      symbol: p.symbol,
      name: nameBySym.get(p.symbol) ?? p.symbol,
      sector: p.sector,
      shares: p.shares,
      marketValue: p.marketValue,
      inKmi30,
      inKmiAllShare: inKmiAll,
      compliant,
      dividendThisYear,
      purificationPct,
      purificationDue: (dividendThisYear * purificationPct) / 100,
    };
  });
  const sumBy = (f: (h: ShariahHolding) => boolean) => out.filter(f).reduce((s, h) => s + h.marketValue, 0);
  const compliantValue = sumBy((h) => h.compliant === true);
  const nonCompliantValue = sumBy((h) => h.compliant === false);
  const unknownValue = sumBy((h) => h.compliant === null);
  return {
    holdings: out.sort((a, b) => b.marketValue - a.marketValue),
    compliantValue,
    nonCompliantValue,
    unknownValue,
    totalValue: compliantValue + nonCompliantValue + unknownValue,
    totalPurification: out.reduce((s, h) => s + h.purificationDue, 0),
    taxYearLabel: ty.label,
  };
}

export async function getMarketContext(symbol: string): Promise<MarketContext> {
  const sym = symbol.toUpperCase();
  const [eod, prices, mw] = await Promise.all([
    fetchEodSeries(sym).catch(() => [] as { date: string; close: number }[]),
    getCurrentPrices([sym]),
    fetchMarketWatch().catch(() => null),
  ]);
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const closes = eod.filter((p) => p.date >= cutoff).map((p) => p.close).filter((c) => c > 0);
  const week52High = closes.length ? Math.max(...closes) : null;
  const week52Low = closes.length ? Math.min(...closes) : null;
  const price = prices.get(sym) ?? 0;
  const positionPct =
    week52High != null && week52Low != null && week52High > week52Low && price > 0
      ? ((price - week52Low) / (week52High - week52Low)) * 100
      : null;
  const row = mw?.get(sym);
  const indices = row ? row.listedIn.map(indexLabel) : [];
  return { symbol: sym, price, week52High, week52Low, positionPct, indices };
}

async function _getCashSummary(): Promise<CashSummary> {
  if (!(await tryConnect())) {
    return {
      balance: 0,
      deposits: 0,
      withdrawals: 0,
      dividendsCollected: 0,
      proceedsFromSells: 0,
      spentOnBuys: 0,
      impliedDeposits: 0,
      topUps: [],
      cgtWithheld: 0,
    };
  }
  const [entries, txs, settings] = await Promise.all([
    CashEntryModel.find({ userId: await meId() }).lean(),
    TransactionModel.find({ userId: await meId(), deletedAt: null }).lean(),
    getAppSettings() as Promise<any>,
  ]);
  const cgtRatePct = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  return computeCashBalance(txs as any, entries as any, { cgtRatePct });
}

export async function getCashEntries() {
  if (!(await tryConnect())) return [];
  const docs = await CashEntryModel.find({ userId: await meId() }).sort({ date: -1, createdAt: -1 }).lean();
  return plain<Array<{ _id: string; date: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number; notes: string }>>(docs);
}

// --- SBP live rates: fetched, never guessed --------------------------------
// The policy rate is GLOBAL data (same for everyone), so it lives in an
// unprefixed FeedSnapshot, refreshed by the snapshots cron like fund yields.
const SBP_TTL_MS = 12 * 60 * 60 * 1000; // serve the stored value up to 12h
const SBP_KEY = "sbpRates";

// `firstSeenFrom` = the first date we OBSERVED this policy rate. SBP publishes
// the current rate but not its effective date, so we record when we first saw
// it rather than inventing an MPC date. History before that keeps using the
// real curated steps.
type StoredSbp = { rates: SbpRates; firstSeenFrom: string };

async function _getSbpLive(): Promise<StoredSbp | null> {
  const snap = await getFeedSnapshot<StoredSbp>(SBP_KEY);
  const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
  if (snap.data != null && age < SBP_TTL_MS) return snap.data;

  const live = await fetchSbpRates();
  if (!live || live.policyRatePct == null) return snap.data ?? null;
  // SBP sets the corridor exactly 100bp either side of the policy rate. If both
  // bounds parsed but that identity fails, we grabbed the wrong cell (the old
  // bug read the floor as the policy rate) — keep last-known-good instead.
  const canCrossCheck = live.repoCeilingPct != null && live.repoFloorPct != null;
  if (canCrossCheck && !corridorAgrees(live)) return snap.data ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const unchanged = snap.data && snap.data.rates.policyRatePct === live.policyRatePct;
  const next: StoredSbp = {
    rates: live,
    firstSeenFrom: unchanged ? snap.data!.firstSeenFrom : today,
  };
  await saveFeedSnapshot(SBP_KEY, next, "ok", `policy ${live.policyRatePct}%`).catch(() => {});
  return next;
}
export const getSbpLive = cache(_getSbpLive);

export async function refreshSbpRates(): Promise<Record<string, unknown>> {
  if (!(await tryConnect())) return { status: "no-db" };
  const live = await fetchSbpRates();
  if (!live || live.policyRatePct == null) return { status: "error", note: "SBP unreachable or unparseable" };
  const canCrossCheck = live.repoCeilingPct != null && live.repoFloorPct != null;
  if (canCrossCheck && !corridorAgrees(live)) return { status: "error", note: "corridor cross-check failed" };
  const snap = await getFeedSnapshot<StoredSbp>(SBP_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const unchanged = snap.data && snap.data.rates.policyRatePct === live.policyRatePct;
  await saveFeedSnapshot(
    SBP_KEY,
    { rates: live, firstSeenFrom: unchanged ? snap.data!.firstSeenFrom : today },
    "ok",
    `policy ${live.policyRatePct}%`
  ).catch(() => {});
  return { status: "ok", policyRatePct: live.policyRatePct, tbill12mPct: tbill12mPct(live), usdPkrM2M: live.usdPkrM2M };
}

// --- Inflation: fetched from PBS, never assumed ------------------------------
// CPI is GLOBAL data. PBS publishes monthly, so a 24h TTL is generous. The app
// used to default inflation to 0 (making every "real return" wrong by the whole
// rate of inflation) and the income planner hardcoded 10.
const INFLATION_TTL_MS = 24 * 60 * 60 * 1000;
const INFLATION_KEY = "inflationPk";

async function _getInflationLive(): Promise<InflationData | null> {
  const snap = await getFeedSnapshot<InflationData>(INFLATION_KEY);
  const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
  if (snap.data != null && age < INFLATION_TTL_MS) return snap.data;
  const live = await fetchInflation();
  if (!live) return snap.data ?? null; // keep last-known-good rather than guess
  await saveFeedSnapshot(INFLATION_KEY, live, "ok", `CPI ${live.latest?.period} YoY ${live.yoyPct?.toFixed(2)}%`).catch(() => {});
  return live;
}
export const getInflationLive = cache(_getInflationLive);

export async function refreshInflation(): Promise<Record<string, unknown>> {
  if (!(await tryConnect())) return { status: "no-db" };
  const live = await fetchInflation();
  if (!live || live.yoyPct == null) return { status: "error", note: "PBS unreachable or unparseable" };
  await saveFeedSnapshot(INFLATION_KEY, live, "ok", `CPI ${live.latest?.period} YoY ${live.yoyPct.toFixed(2)}%`).catch(() => {});
  return { status: "ok", yoyPct: live.yoyPct, period: live.latest?.period, months: live.history.length };
}

// The published T-bill (12M MTB cut-off) yield — the real risk-free rate a saver
// can actually lock in. null when SBP hasn't published one we could parse.
async function _getTbill12mPct(): Promise<number | null> {
  if (!(await tryConnect())) return null;
  return tbill12mPct((await getSbpLive())?.rates ?? null);
}
export const getTbill12mPct = cache(_getTbill12mPct);

// Per-stock beta vs the KSE-100, measured by the analytics service from real
// price history. Drives the per-company required return (see calculations/capm.ts).
// Analytics is unreachable -> empty map -> every stock falls back to beta 1
// (plain market risk), which is the old flat behaviour. We never invent a beta.
async function _getBetaMap(): Promise<Map<string, number>> {
  try {
    const { getRatings } = await import("./analytics");
    const data = await getRatings(500);
    const m = new Map<string, number>();
    for (const r of data?.results ?? []) {
      if (r.beta != null && Number.isFinite(r.beta)) m.set(r.symbol.toUpperCase(), r.beta);
    }
    return m;
  } catch {
    return new Map();
  }
}
export const getBetaMap = cache(_getBetaMap);

// Effective inflation: the user's manual override in Settings wins when set
// (>0); otherwise the live PBS CPI figure. `source` lets every consumer say
// where its number came from instead of presenting it as ambient truth.
async function _getEffectiveInflationPct(): Promise<{ pct: number | null; source: "manual" | "pbs" | "none"; period: string | null }> {
  const settings: any = await getAppSettings();
  const manual = Number(settings?.inflationPct ?? 0);
  if (manual > 0) return { pct: manual, source: "manual", period: null };
  const live = await getInflationLive();
  if (live?.yoyPct != null) return { pct: live.yoyPct, source: "pbs", period: live.latest?.period ?? null };
  return { pct: null, source: "none", period: null };
}
export const getEffectiveInflationPct = cache(_getEffectiveInflationPct);

// "What moved my portfolio" — the last-N-days change split into per-holding
// rupee contributions (price moves on current shares; see calculations/attribution).
async function _getAttribution(days = 30): Promise<Attribution> {
  const summary = await getPortfolioSummary();
  const held = summary.positions.filter((x) => x.shares > 0);
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const eod = held.length
    ? await fetchManyEod(held.map((h) => h.symbol)).catch(() => new Map<string, { date: string; close: number }[]>())
    : new Map<string, { date: string; close: number }[]>();
  return computeAttribution({
    positions: held.map((x) => ({ symbol: x.symbol, shares: x.shares, priceKnown: x.priceKnown, currentPrice: x.currentPrice })),
    series: eod,
    sinceIso,
  });
}
export const getAttribution = cache(_getAttribution);

// SBP policy-rate steps, in priority order:
//   user  — the user's own curve from Settings (they override everything)
//   live  — SBP's published current rate, prepended to the real history
//   stale — live feed down: newest REAL past step, flagged so the UI can say so
// `isCustom` tells the UI the user's curve is active; `source` tells it whether
// today's number came from SBP or is a stale fallback.
async function _getSbpRateSteps(): Promise<{
  steps: RateStep[];
  isCustom: boolean;
  source: "user" | "live" | "stale";
  liveAsOf: string | null;
}> {
  if (!(await tryConnect())) {
    return { steps: SBP_POLICY_RATE_DEFAULTS, isCustom: false, source: "stale", liveAsOf: null };
  }
  const docs = await SbpRateModel.find({ userId: await meId() }).sort({ effectiveDate: -1 }).lean();
  if (docs.length > 0) {
    return {
      steps: docs.map((d) => ({ from: d.effectiveDate, rate: d.rate })),
      isCustom: true,
      source: "user",
      liveAsOf: null,
    };
  }
  const live = await getSbpLive();
  if (live?.rates.policyRatePct != null) {
    return {
      steps: [{ from: live.firstSeenFrom, rate: live.rates.policyRatePct }, ...SBP_POLICY_RATE_DEFAULTS],
      isCustom: false,
      source: "live",
      liveAsOf: live.rates.fetchedAt.slice(0, 10),
    };
  }
  return { steps: SBP_POLICY_RATE_DEFAULTS, isCustom: false, source: "stale", liveAsOf: null };
}
export const getSbpRateSteps = cache(_getSbpRateSteps);

export async function getSbpRates() {
  if (!(await tryConnect())) return [];
  const docs = await SbpRateModel.find({ userId: await meId() }).sort({ effectiveDate: -1 }).lean();
  return plain<Array<{ _id: string; effectiveDate: string; rate: number; note: string }>>(docs);
}

export type ValuedFund = {
  _id: string;
  name: string;
  mufapName: string;
  amc: string;
  avgCost: number;
  fundType: string;
  moneyMarket: boolean;
  annualYieldPct: number;
  anchorDate: string;
  notes: string;
  nav: number; // 0 if NAV unavailable
  navFound: boolean;
  navAsOf: string; // date of the NAV used; older than today = MUFAP feed down, serving last-good
  // Live MUFAP-published trailing-12-month return (the real annual yield).
  // null when MUFAP has no figure — the UI then shows the manual value, marked.
  liveAnnualYieldPct: number | null;
  liveYieldAsOf: string;
} & FundValuation;

// --- Fund yields: persistent + self-refreshing -------------------------------
// MUFAP's published returns are GLOBAL data (same for every user), so they live
// in an unprefixed FeedSnapshot per fund id. The hourly snapshots cron calls
// refreshAllFundYields(), which re-fetches once a day and also keeps each fund
// record's stored annualYieldPct (the manual fallback) in sync — so yields stay
// current without anyone touching them.
const FUND_RETURNS_TTL_MS = 26 * 60 * 60 * 1000; // serve the stored value up to 26h
const FUND_RETURNS_REFRESH_MS = 20 * 60 * 60 * 1000; // cron re-fetches after 20h

type StoredFundReturns = { ytdPct: number | null; year1Pct: number | null; day30Pct: number | null; asOf: string };

async function getFundReturnsStored(fundId: number): Promise<StoredFundReturns | null> {
  const key = `fundReturns:${fundId}`;
  const snap = await getFeedSnapshot<StoredFundReturns>(key);
  const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
  if (snap.data != null && age < FUND_RETURNS_TTL_MS) return snap.data;
  const live = await fetchFundReturns(fundId);
  if (live) await saveFeedSnapshot(key, live, "ok").catch(() => {});
  return live ?? snap.data ?? null;
}

export async function refreshAllFundYields(): Promise<Record<string, unknown>> {
  if (!(await tryConnect())) return { status: "no-db" };
  // Distinct fund names across ALL users — the yield is the same fund either way.
  const names: string[] = await MutualFundModel.distinct("mufapName");
  if (names.length === 0) return { status: "ok", funds: 0 };
  const navs = await fetchAllNavs(true);
  const byName = new Map(navs.map((n) => [n.name.toLowerCase(), n]));
  let updated = 0, fresh = 0, failed = 0;
  for (const name of names) {
    const entry = byName.get(name.toLowerCase()) ?? (await findNav(name));
    if (!entry?.fundId) { failed++; continue; }
    const key = `fundReturns:${entry.fundId}`;
    const snap = await getFeedSnapshot<StoredFundReturns>(key);
    const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
    if (snap.data != null && age < FUND_RETURNS_REFRESH_MS) { fresh++; continue; }
    const live = await fetchFundReturns(entry.fundId);
    if (!live) { failed++; continue; }
    await saveFeedSnapshot(key, live, "ok").catch(() => {});
    // Keep the stored fallback current too (only with a real published figure).
    if (live.year1Pct != null && Number.isFinite(live.year1Pct)) {
      await MutualFundModel.updateMany({ mufapName: name }, { $set: { annualYieldPct: live.year1Pct } }).catch(() => {});
    }
    updated++;
  }
  return { status: "ok", funds: names.length, updated, fresh, failed };
}

// Last-good MUFAP NAVs, durable. MUFAP has started 403-ing datacentre IPs
// (same wall as NCCPL); when the live fetch fails AND the in-memory cache is
// cold (e.g. after a restart), the previous behaviour valued funds at NAV 0 —
// a fabricated -100% that silently dropped them from net worth. A money-market
// NAV moves ~0.03%/day, so serving the last REAL published NAV (flagged with
// its date) is honest; zero never is.
const MUFAP_NAVS_KEY = "mufapNavs";

async function _getMutualFundsValued(): Promise<ValuedFund[]> {
  if (!(await tryConnect())) return [];
  const docs = await MutualFundModel.find({ userId: await meId() }).sort({ name: 1 }).lean();
  if (docs.length === 0) return [];
  let navs = await fetchAllNavs();
  let navAsOf = new Date().toISOString().slice(0, 10);
  if (navs.length > 0) {
    // Live fetch worked — refresh the durable copy.
    await saveFeedSnapshot(MUFAP_NAVS_KEY, { at: navAsOf, navs }, "ok", `${navs.length} funds`).catch(() => {});
  } else {
    const snap = await getFeedSnapshot<{ at: string; navs: typeof navs }>(MUFAP_NAVS_KEY);
    if (snap.data?.navs?.length) {
      navs = snap.data.navs;
      navAsOf = snap.data.at;
    }
  }
  const byName = new Map(navs.map((n) => [n.name.toLowerCase(), n]));
  const out: ValuedFund[] = [];
  for (const f of docs) {
    let entry = byName.get(f.mufapName.toLowerCase()) ?? null;
    if (!entry) entry = await findNav(f.mufapName);
    const nav = entry?.nav ?? 0;
    // Real annual yield: MUFAP's published trailing-12-month return for this
    // fund, served from the daily-refreshed snapshot (no live wait on MUFAP).
    const returns = entry?.fundId ? await getFundReturnsStored(entry.fundId) : null;
    const liveAnnualYieldPct = returns?.year1Pct ?? null;
    const dailyDividend = (f as any).fundType === "dailyDividend";
    // Daily-dividend accrual runs on the LIVE annual yield when MUFAP has one;
    // the stored manual figure is only the fallback.
    const accrualYieldPct = liveAnnualYieldPct ?? ((f as any).annualYieldPct ?? 0);
    // Money-market status is stored, but a fund added before the flag existed
    // still has to behave correctly, so fall back to reading the name. Cash and
    // money-market funds are the only ones carried forward between NAV publishes.
    const moneyMarket =
      (f as any).moneyMarket ?? /cash|money\s*market|liquid|savings/i.test(f.mufapName || f.name || "");
    const v = valueFund(
      {
        units: f.units,
        avgCost: f.avgCost,
        dailyDividend,
        moneyMarket,
        annualYieldPct: accrualYieldPct,
        anchorDate: (f as any).anchorDate ?? "",
      },
      nav,
      undefined,
      navAsOf
    );
    out.push({
      ...v, // units, nav, effectiveNav, dailyYieldPct, value, cost, unrealizedPL, unrealizedPct, dailyDividend
      _id: String(f._id),
      name: f.name,
      mufapName: f.mufapName,
      amc: f.amc,
      avgCost: f.avgCost,
      fundType: (f as any).fundType ?? "growth",
      moneyMarket,
      annualYieldPct: (f as any).annualYieldPct ?? 0,
      anchorDate: (f as any).anchorDate ?? "",
      notes: f.notes,
      navFound: nav > 0,
      navAsOf,
      liveAnnualYieldPct,
      liveYieldAsOf: returns?.asOf ?? "",
    });
  }
  return out;
}

export type ValuedSavings = {
  _id: string;
  name: string;
  bank: string;
  ratePercent: number;
  anchorDate: string;
  anchorBalance: number;
  notes: string;
  movements: Array<{ _id?: string; date: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number; note: string }>;
} & SavingsValuation;

async function _getSavingsValued(): Promise<ValuedSavings[]> {
  if (!(await tryConnect())) return [];
  const docs = await SavingsAccountModel.find({ userId: await meId() }).sort({ name: 1 }).lean();
  return docs.map((a) => {
    const v = valueSavings({
      ratePercent: a.ratePercent,
      anchorDate: a.anchorDate,
      anchorBalance: a.anchorBalance,
      movements: (a.movements ?? []) as any,
    });
    return {
      _id: String(a._id),
      name: a.name,
      bank: a.bank,
      ratePercent: a.ratePercent,
      anchorDate: a.anchorDate,
      anchorBalance: a.anchorBalance,
      notes: a.notes,
      movements: plain(a.movements ?? []),
      ...v,
    };
  });
}

export type NetWorth = {
  equity: number; // PSX holdings market value
  funds: number; // mutual funds value
  savings: number; // savings accounts accrued value
  total: number;
  breakdown: { label: string; value: number }[];
};

// Brokerage cash is deliberately NOT an asset here.
//
// The balance in lib/calculations/cash.ts is DERIVED — deposits + sells +
// dividends − buys − withdrawals — so it is only as true as the deposit ledger
// is complete. This book was rebuilt from an NCCPL tax certificate, which
// carries every trade but no cash movements, so the deposits recorded cover a
// few weeks against years of buys. What comes out the other end is arithmetic
// residue, not money in an account, and putting it in net worth states a
// balance nobody measured. Same principle as an unpriced position: a number
// that cannot be known is left out rather than asserted.
//
// The ledger itself is untouched — CashEntry rows, /api/cash and the Cash
// summary all still work. If every deposit and withdrawal is ever recorded,
// counting it again is a small change.
async function _getNetWorth(): Promise<NetWorth> {
  const [summary, funds, savings] = await Promise.all([
    getPortfolioSummary(),
    getMutualFundsValued(),
    getSavingsValued(),
  ]);
  const equity = summary.totalValue;
  const fundsTotal = funds.reduce((s, f) => s + f.value, 0);
  const savingsTotal = savings.reduce((s, a) => s + a.balance, 0);
  const total = equity + fundsTotal + savingsTotal;
  return {
    equity,
    funds: fundsTotal,
    savings: savingsTotal,
    total,
    breakdown: [
      { label: "PSX equities", value: equity },
      { label: "Mutual funds", value: fundsTotal },
      { label: "Savings", value: savingsTotal },
    ].filter((b) => b.value > 0),
  };
}

export type AppSettings = typeof DEFAULT_SETTINGS;

async function _getAppSettings(): Promise<AppSettings> {
  const uid = await getCurrentUserId();
  if (!uid || !(await tryConnect())) return { ...DEFAULT_SETTINGS };
  const doc = await AppSettingsModel.findOneAndUpdate(
    { userId: uid },
    { userId: uid, key: uid },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  return {
    filerStatus: (doc?.filerStatus as any) ?? DEFAULT_SETTINGS.filerStatus,
    dividendWhtFiler: doc?.dividendWhtFiler ?? DEFAULT_SETTINGS.dividendWhtFiler,
    dividendWhtNonFiler: doc?.dividendWhtNonFiler ?? DEFAULT_SETTINGS.dividendWhtNonFiler,
    cgtRateFiler: doc?.cgtRateFiler ?? DEFAULT_SETTINGS.cgtRateFiler,
    cgtRateNonFiler: doc?.cgtRateNonFiler ?? DEFAULT_SETTINGS.cgtRateNonFiler,
    pmexCommissionPerLot: doc?.pmexCommissionPerLot ?? DEFAULT_SETTINGS.pmexCommissionPerLot,
    pmexCgtPercent: doc?.pmexCgtPercent ?? DEFAULT_SETTINGS.pmexCgtPercent,
    concentrationCap: doc?.concentrationCap ?? DEFAULT_SETTINGS.concentrationCap,
    mfCashReservePct: (doc as any)?.mfCashReservePct ?? DEFAULT_SETTINGS.mfCashReservePct,
    strictBuyZones: (doc as any)?.strictBuyZones ?? (DEFAULT_SETTINGS as any).strictBuyZones ?? false,
    equityRiskPremiumPct: (doc as any)?.equityRiskPremiumPct ?? DEFAULT_SETTINGS.equityRiskPremiumPct,
    defaultFairPE: (doc as any)?.defaultFairPE ?? DEFAULT_SETTINGS.defaultFairPE,
    targetMonthlyIncome: (doc as any)?.targetMonthlyIncome ?? DEFAULT_SETTINGS.targetMonthlyIncome,
    telegramBotToken: (doc as any)?.telegramBotToken ?? "",
    telegramChatId: (doc as any)?.telegramChatId ?? "",
    alertsEnabled: (doc as any)?.alertsEnabled ?? false,
  } as AppSettings;
}

export type CgtReport = {
  summary: CgtSummary;
  recentDisposals: Disposal[];
  rate: number;
};

export type HarvestCandidate = {
  symbol: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  cost: number;
  unrealizedLoss: number; // negative
};

export type HarvestReport = {
  candidates: HarvestCandidate[];
  totalHarvestableLoss: number;
  realizedGainThisYear: number;
  offsetPotential: number; // min(harvestable loss, realized gain)
  cgtSaved: number;
  rate: number;
};

export type SellTodayRow = {
  symbol: string;
  shares: number;
  avgCost: number;
  price: number;
  marketValue: number;
  cost: number;
  gain: number;
  gainPct: number;
  weightedDays: number; // share-weighted holding period
  longTermShares: number; // held > 365 days
  cgtIfSold: number;
};

export type CorporateActionSuggestion = {
  symbol: string;
  type: "BONUS" | "RIGHT";
  pct: number; // announced % (of holding for bonus; rights ratio as announced)
  bookClosure: string;
  cycle: string;
  heldShares: number; // held TODAY — the card says so
  suggestedShares: number; // floor(held × pct / 100)
};

// Announced bonus/right issues on HELD symbols that have no matching recorded
// transaction yet — surfaced as pre-filled suggestions, never auto-applied.
// Window: book closures from 60 days back (you may not have recorded it) to 45
// days ahead (it's coming). The share math uses TODAY's holding and says so —
// entitlement actually depends on shares held AT book closure.
export async function getCorporateActionSuggestions(): Promise<CorporateActionSuggestion[]> {
  if (!(await tryConnect())) return [];
  const [holdings, txs] = await Promise.all([
    HoldingModel.find({ userId: await meId(), currentShares: { $gt: 0 } }).lean(),
    getAllTransactions(),
  ]);
  const held = new Map(holdings.map((h: any) => [h.symbol, h.currentShares as number]));
  if (held.size === 0) return [];
  const funds: any[] = await FundamentalModel.find({ symbol: { $in: [...held.keys()] } }).lean();

  const today = new Date();
  const from = new Date(today.getTime() - 60 * 86400000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 45 * 86400000).toISOString().slice(0, 10);

  const out: CorporateActionSuggestion[] = [];
  for (const f of funds) {
    for (const p of f.payouts ?? []) {
      const t = p.payoutType === "bonus" ? "BONUS" : p.payoutType === "right" ? "RIGHT" : null;
      const bc = p.bookClosure;
      if (!t || !bc || bc < from || bc > to || !(p.pctOfFace > 0)) continue;
      // Already recorded? A BONUS/RIGHT transaction within 3 weeks of the
      // book closure counts as done.
      const recorded = txs.some(
        (tx) => tx.symbol === f.symbol && tx.type === t && Math.abs(new Date(tx.date).getTime() - new Date(bc).getTime()) < 21 * 86400000
      );
      if (recorded) continue;
      const heldShares = held.get(f.symbol) ?? 0;
      out.push({
        symbol: f.symbol,
        type: t,
        pct: p.pctOfFace,
        bookClosure: bc,
        cycle: p.cycle ?? "",
        heldShares,
        suggestedShares: Math.floor((heldShares * p.pctOfFace) / 100),
      });
    }
  }
  return out.sort((a, b) => a.bookClosure.localeCompare(b.bookClosure));
}

export type FbrDividendRow = { symbol: string; count: number; gross: number; wht: number; zakat: number; net: number };

export type FbrPack = {
  year: import("./dates").PkTaxYear;
  years: number[]; // endYears that have any dividend or disposal activity
  dividends: FbrDividendRow[];
  divTotals: { gross: number; wht: number; zakat: number; net: number };
  disposals: Disposal[];
  cgt: { netGain: number; longTermGain: number; shortTermGain: number; cgt: number; rate: number };
};

// Everything the FBR return needs for ONE tax year, from recorded warrants and
// FIFO disposals. Defaults to the last COMPLETED tax year — that's the one you
// file. Savings profit-on-debt is deliberately absent: the bank's certificate
// is the filing document there, and we won't put an estimate next to exacts.
export async function getFbrPack(endYear?: number): Promise<FbrPack> {
  const { taxYearOf, currentTaxYear } = await import("./dates");
  const [txs, settings] = await Promise.all([getAllTransactions(), getAppSettings()]);

  const bySymbol = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  const allDisposals: Disposal[] = [];
  for (const [sym, list] of bySymbol) allDisposals.push(...buildLots(sym, list).disposals);

  const activeYears = new Set<number>();
  for (const t of txs) if (t.type === "DIVIDEND") activeYears.add(taxYearOf(t.date).endYear);
  for (const d of allDisposals) activeYears.add(taxYearOf(d.soldDate).endYear);

  const year = taxYearOf(new Date(Date.UTC(endYear ?? currentTaxYear().endYear - 1, 0, 15)));

  const divMap = new Map<string, FbrDividendRow>();
  for (const t of txs) {
    if (t.type !== "DIVIDEND" || taxYearOf(t.date).endYear !== year.endYear) continue;
    const row = divMap.get(t.symbol) ?? { symbol: t.symbol, count: 0, gross: 0, wht: 0, zakat: 0, net: 0 };
    row.count += 1;
    row.gross += t.totalAmount;
    row.wht += t.taxDeducted ?? 0;
    row.zakat += t.zakatDeducted ?? 0;
    row.net += t.netAmount;
    divMap.set(t.symbol, row);
  }
  const dividends = [...divMap.values()].sort((a, b) => b.gross - a.gross);
  const divTotals = dividends.reduce(
    (s, r) => ({ gross: s.gross + r.gross, wht: s.wht + r.wht, zakat: s.zakat + r.zakat, net: s.net + r.net }),
    { gross: 0, wht: 0, zakat: 0, net: 0 }
  );

  const disposals = allDisposals
    .filter((d) => taxYearOf(d.soldDate).endYear === year.endYear)
    .sort((a, b) => a.soldDate.localeCompare(b.soldDate));
  const rate = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const netGain = disposals.reduce((s, d) => s + d.gain, 0);
  const longTermGain = disposals.filter((d) => d.longTerm).reduce((s, d) => s + d.gain, 0);

  return {
    year,
    years: [...activeYears].sort((a, b) => b - a),
    dividends,
    divTotals,
    disposals,
    cgt: { netGain, longTermGain, shortTermGain: netGain - longTermGain, cgt: Math.max(0, netGain) * (rate / 100), rate },
  };
}

async function _getRiskMetrics(): Promise<RiskMetrics | null> {
  return cachedSnapshot("page:riskMetrics", 90 * 60 * 1000, computeRiskMetrics);
}

async function computeRiskMetrics(): Promise<RiskMetrics | null> {
  const { steps } = await getSbpRateSteps();
  // Reuse the cached 1Y benchmark series (warmed by the cron) instead of
  // rebuilding it live — that rebuild was the dashboard's main slowdown.
  const snap = await getFeedSnapshot<any>(`benchmark:1Y:${await meId()}`);
  let series: any = snap.data;
  if (!series || !Array.isArray(series.points)) {
    const txs = await getAllTransactions();
    series = await buildBenchmarkSeries({ transactions: txs, rangeKey: "1Y", rateSteps: steps });
  }
  if (!series) return null;
  const portfolio = series.points.map((p: any) => p.portfolio).filter((x: any): x is number => x != null);
  const benchmark = series.points.map((p: any) => p.kse100).filter((x: any): x is number => x != null);
  const rf = policyRateOn(new Date().toISOString().slice(0, 10), steps) / 100;
  return computeRisk({ portfolio, benchmark, riskFreeAnnual: rf });
}

export type ValuedTrade = {
  _id: string;
  symbol: string;
  name: string;
  side: "LONG" | "SHORT";
  lots: number;
  lotSize: number;
  entryPrice: number;
  entryDate: string;
  exitPrice: number | null;
  exitDate: string | null;
  currentPrice: number | null;
  status: string;
  notes: string;
  expiryDate: string | null;
  contractType: string;
  marginPosted: number;
} & TradeValuation & { expiry: import("./calculations/pmex").ExpiryStatus };

export async function getCommodityTradesValued(): Promise<{ trades: ValuedTrade[]; settings: AppSettings }> {
  const settings = await getAppSettings();
  if (!(await tryConnect())) return { trades: [], settings };
  const docs = await CommodityTradeModel.find({ userId: await meId() }).sort({ entryDate: -1 }).lean();
  const trades = docs.map((t) => {
    const v = valueTrade(
      {
        side: t.side as "LONG" | "SHORT",
        lots: t.lots,
        lotSize: t.lotSize,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice ?? null,
        currentPrice: t.currentPrice ?? null,
        status: t.status,
        marginPosted: t.marginPosted ?? 0,
      },
      settings.pmexCommissionPerLot,
      settings.pmexCgtPercent
    );
    return {
      _id: String(t._id),
      symbol: t.symbol,
      name: t.name,
      side: t.side as "LONG" | "SHORT",
      lots: t.lots,
      lotSize: t.lotSize,
      entryPrice: t.entryPrice,
      entryDate: t.entryDate,
      exitPrice: t.exitPrice ?? null,
      exitDate: t.exitDate ?? null,
      currentPrice: t.currentPrice ?? null,
      status: t.status,
      notes: t.notes,
      expiryDate: t.expiryDate ?? null,
      contractType: t.contractType ?? "CASH_SETTLED",
      marginPosted: t.marginPosted ?? 0,
      expiry: expiryStatus(
        { status: t.status, expiryDate: t.expiryDate ?? null, contractType: t.contractType ?? "CASH_SETTLED" },
        new Date().toISOString().slice(0, 10)
      ),
      ...v,
    };
  });
  return { trades, settings };
}

export type PmexOverview = {
  trades: ValuedTrade[];
  settings: AppSettings;
  summary: PmexSummary;
  years: FyWindow[];
  // Live international reference per open instrument, so a stale mark is
  // obvious at a glance. These NEVER feed P/L — PMEX settles on its own
  // prices, so only the mark the user entered is treated as truth.
  refs: Array<{ symbol: string; label: string; pkr: number | null; unit: string; kind: string }>;
};

// The PMEX account itself: what it holds and what trading it cost. Separate
// from the contract list because PMEX publishes profit per session and never
// per position, so this can be known exactly while the contracts cannot be
// reconstructed at all. Null when no statement has been recorded.
export type PmexAccountView = {
  accountNo: string;
  balanceAsOf: string;
  statementFrom: string;
  statementTo: string;
  sessions: Array<{ date: string; contract: string; realised: number; unrealised: number }>;
} & PmexAccountSummary;

async function _getPmexAccount(): Promise<PmexAccountView | null> {
  if (!(await tryConnect())) return null;
  const doc = await PmexAccountModel.findOne({ userId: await meId() }).sort({ balanceAsOf: -1 }).lean();
  if (!doc) return null;
  const summary = summarisePmexAccount(
    doc.openingBalance,
    (doc.movements ?? []) as PmexMovement[],
    doc.balance
  );
  return {
    accountNo: doc.accountNo,
    balanceAsOf: doc.balanceAsOf,
    statementFrom: doc.statementFrom ?? "",
    statementTo: doc.statementTo ?? "",
    sessions: (doc.sessions ?? []).map((s) => ({
      date: s.date,
      contract: s.contract ?? "",
      realised: s.realised ?? 0,
      unrealised: s.unrealised ?? 0,
    })),
    ...summary,
  };
}
export const getPmexAccount = cache(_getPmexAccount);

export async function getPmexOverview(endYear?: number): Promise<PmexOverview> {
  const { trades, settings } = await getCommodityTradesValued();
  const asPure = trades.map((t) => ({
    symbol: t.symbol,
    side: t.side,
    lots: t.lots,
    lotSize: t.lotSize,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    currentPrice: t.currentPrice,
    status: t.status,
    entryDate: t.entryDate,
    exitDate: t.exitDate,
    expiryDate: t.expiryDate,
    contractType: t.contractType,
    marginPosted: t.marginPosted,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const fy = endYear ? fyWindow(endYear) : financialYearOf(today);
  const summary = summarisePmex(asPure, settings.pmexCommissionPerLot, settings.pmexCgtPercent, fy, today);
  const years = activeFinancialYears(asPure);
  if (!years.some((y) => y.endYear === fy.endYear)) years.unshift(fy);

  const openSymbols = [...new Set(trades.filter((t) => t.isOpen).map((t) => t.symbol))];
  const settled = await Promise.allSettled(openSymbols.map((s) => getCommodityRef(s)));
  const refs = settled
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({ symbol: r.symbol, label: r.label, pkr: r.pkr, unit: r.unit, kind: r.kind }));

  return { trades, settings, summary, years, refs };
}

export type Mover = { symbol: string; price: number; prevClose: number; changePct: number };

async function _getTodaysMovers(): Promise<{ gainers: Mover[]; losers: Mover[] }> {
  return cachedSnapshot("page:todaysMovers", 90 * 60 * 1000, computeTodaysMovers);
}

async function computeTodaysMovers(): Promise<{ gainers: Mover[]; losers: Mover[] }> {
  const holdings = await getAllHoldings();
  const active = holdings.filter((h) => (h.currentShares ?? 0) > 0);
  // Fetch every symbol's EOD in PARALLEL (was a sequential await-loop).
  const results = await Promise.all(
    active.map(async (h) => {
      try {
        const eod = await fetchEodSeries(h.symbol);
        if (eod.length < 2) return null;
        const price = eod[eod.length - 1].close;
        const prevClose = eod[eod.length - 2].close;
        if (prevClose > 0) return { symbol: h.symbol, price, prevClose, changePct: price / prevClose - 1 };
      } catch {
        /* skip */
      }
      return null;
    })
  );
  const movers = results.filter((m): m is Mover => m != null);
  const sorted = [...movers].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.filter((m) => m.changePct > 0).slice(0, 3),
    losers: sorted.filter((m) => m.changePct < 0).reverse().slice(0, 3),
  };
}

export async function getWatchlist() {
  if (!(await tryConnect())) return [];
  const docs = await WatchlistEntryModel.find({ userId: await meId() }).sort({ createdAt: -1 }).lean();
  return plain<Array<{ _id: string; symbol: string; name: string; sector: string; notes: string; targetBuyPrice: number | null; targetSellPrice: number | null; buyZoneLow: number | null; buyZoneHigh: number | null; sellZoneLow: number | null; sellZoneHigh: number | null; minHoldingShares: number; minSellShares: number; alertsOn: boolean; createdAt: string }>>(docs);
}

export const checkDataAvailability = cache(_checkDataAvailability);

export const getAllTransactions = cache(_getAllTransactions);

export const getPortfolioSummary = cache(_getPortfolioSummary);

export const getNetWorth = cache(_getNetWorth);

export const getAppSettings = cache(_getAppSettings);

export const getRiskMetrics = cache(_getRiskMetrics);

export const getTodaysMovers = cache(_getTodaysMovers);

// --- Sparklines -------------------------------------------------------------
// A 90-day close series per symbol, thinned to ~40 points, for the trend
// glyphs on the holdings table. Prices are GLOBAL, so this caches unprefixed
// and is shared by every account.
//
// Cached hard, because the holdings page is the most-visited screen in the app
// and it must not wait on a dozen round-trips to the exchange to draw a 60px
// picture. A miss returns what it has — a table with no sparklines is a table;
// a table that takes eight seconds is not.
const SPARKLINE_KEY = "sparklines";
const SPARKLINE_TTL_MS = 6 * 60 * 60 * 1000;

export async function getSparklines(symbols: string[]): Promise<Record<string, number[]>> {
  if (symbols.length === 0) return {};
  try {
    const snap = await getFeedSnapshot<Record<string, number[]>>(SPARKLINE_KEY);
    const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
    const have = snap.data ?? {};
    const missing = symbols.filter((s) => !have[s]);
    if (age < SPARKLINE_TTL_MS && missing.length === 0) return have;

    const series = await fetchManyEod(symbols, 4);
    const next: Record<string, number[]> = { ...have };
    for (const s of symbols) {
      const pts = series.get(s) ?? [];
      if (pts.length === 0) continue; // keep the previous curve rather than blanking it
      const closes = pts.slice(-90).map((p) => p.close);
      // Thin to ~40 points: more than that is invisible at 60px wide and only
      // makes the payload bigger.
      const step = Math.max(1, Math.ceil(closes.length / 40));
      next[s] = closes.filter((_, i) => i % step === 0);
    }
    await saveFeedSnapshot(SPARKLINE_KEY, next, "ok", `${Object.keys(next).length} symbols`).catch(() => {});
    return next;
  } catch {
    return {};
  }
}

export const getIntrinsicValuations = cache(_getIntrinsicValuations);

export const getAllHoldings = cache(_getAllHoldings);
// These three were each running TWICE per request: the page calls them and
// getNetWorth() calls them again. getMutualFundsValued is also the most
// expensive of the set (a Mongo round-trip per fund), so the duplicate hurt.
export const getCashSummary = cache(_getCashSummary);
export const getMutualFundsValued = cache(_getMutualFundsValued);
export const getSavingsValued = cache(_getSavingsValued);

// --- Zones: the watchlist joined to prices, positions and targets -----------
// One place computes zone status, so the Telegram alert, the watchlist table
// and the rebalance deployment plan can never disagree about whether a stock
// is in its band or how many shares that frees.

export type SellEconomics = {
  shares: number; // whole shares above the minimum holding
  price: number;
  proceeds: number;
  fees: number;
  gain: number; // realised gain on those exact FIFO lots
  cgt: number;
  net: number; // what actually reaches the account
  cgtRatePct: number;
  remainingShares: number; // the core you keep
};

export type ZoneBoardRow = {
  _id: string;
  symbol: string;
  name: string;
  sector: string;
  notes: string;
  price: number | null; // null = no usable price; NEVER shown as 0
  priceAgeDays: number | null;
  priceStale: boolean; // 7 days or older — alerts skip these
  buyZoneLow: number | null;
  buyZoneHigh: number | null;
  sellZoneLow: number | null;
  sellZoneHigh: number | null;
  minHoldingShares: number; // the core you always keep
  alertsOn: boolean;
  status: ZoneStatus;
  sharesHeld: number;
  positionValue: number;
  targetPct: number;
  sellableShares: number; // shares above the floor, 0 when not in a sell band
  sell: SellEconomics | null; // what selling them actually returns
  buyFactor: number; // 0..1 — how hard to buy at today's price
  buyReason: string;
  toBuyPct: number | null; // % above the buy ceiling (negative = inside)
  toSellPct: number | null; // % below the sell floor
  warnings: string[];
};

export type ZoneBoard = {
  rows: ZoneBoardRow[];
  buys: ZoneBoardRow[]; // inside the buy band
  sells: ZoneBoardRow[]; // in the sell band with shares above the floor
  heldAtCore: ZoneBoardRow[]; // in the sell band but already at/under the floor
  conflicts: ZoneBoardRow[]; // contradictory bands — no instruction given
  unpriced: string[];
};

async function _getZoneBoard(): Promise<ZoneBoard> {
  const watch = await getWatchlist();
  if (watch.length === 0) {
    return { rows: [], buys: [], sells: [], heldAtCore: [], conflicts: [], unpriced: [] };
  }
  const symbols = watch.map((w) => w.symbol);
  const [prices, freshness, summary, settings] = await Promise.all([
    getCurrentPrices(symbols),
    getPriceFreshness(symbols).catch(() => new Map()),
    getPortfolioSummary(),
    getAppSettings(),
  ]);
  const posBySymbol = new Map(summary.positions.map((p) => [p.symbol, p]));
  const cgtRatePct =
    (settings as any).filerStatus === "filer" ? (settings as any).cgtRateFiler : (settings as any).cgtRateNonFiler;


  // Bands are advisory by default: a price above your ceiling still gets bought,
  // just less. Turn this on and they become binding — outside the band nothing
  // is bought and the money waits in the fund for the level to arrive.
  const strictZones = !!(await getAppSettings().catch(() => ({} as any)) as any).strictBuyZones;

  const rows: ZoneBoardRow[] = watch.map((w) => {
    // A zone bound falls back to the older single-point target, so rows created
    // before zones existed keep working instead of silently going quiet. The
    // holding floor likewise reads its pre-8.3 name until the migration runs.
    const buyZoneHigh = w.buyZoneHigh ?? w.targetBuyPrice ?? null;
    const sellZoneLow = w.sellZoneLow ?? w.targetSellPrice ?? null;
    const entry: ZoneEntry = {
      symbol: w.symbol,
      buyZoneLow: w.buyZoneLow ?? null,
      buyZoneHigh,
      sellZoneLow,
      sellZoneHigh: w.sellZoneHigh ?? null,
      minHoldingShares: (w as any).minHoldingShares ?? (w as any).minSellShares ?? 0,
    };
    const raw = prices.get(w.symbol) ?? 0;
    const verdict = evaluateZone(raw > 0 ? raw : null, entry);
    const f = freshness.get(w.symbol) as { ageDays: number } | undefined;
    const pos = posBySymbol.get(w.symbol);
    const sharesHeld = pos?.shares ?? 0;
    const dist = verdict.price != null ? distanceToZonePct(verdict.price, entry) : { toBuyPct: null, toSellPct: null };
    const weight = zoneBuyFactor(verdict.price, entry, strictZones);
    return {
      _id: String(w._id),
      symbol: w.symbol,
      name: w.name,
      sector: w.sector,
      notes: w.notes ?? "",
      price: verdict.price,
      priceAgeDays: f?.ageDays ?? null,
      priceStale: (f?.ageDays ?? 0) >= 7,
      buyZoneLow: entry.buyZoneLow,
      buyZoneHigh: entry.buyZoneHigh,
      sellZoneLow: entry.sellZoneLow,
      sellZoneHigh: entry.sellZoneHigh,
      minHoldingShares: entry.minHoldingShares,
      alertsOn: (w as any).alertsOn !== false,
      status: verdict.status,
      sharesHeld,
      positionValue: pos?.marketValue ?? 0,
      targetPct: pos?.targetPercent ?? 0,
      sellableShares: sellableShares(verdict.status, sharesHeld, entry.minHoldingShares),
      sell: null, // filled below, only where something is actually sellable
      buyFactor: weight.factor,
      buyReason: weight.reason,
      toBuyPct: dist.toBuyPct,
      toSellPct: dist.toSellPct,
      warnings: verdict.warnings,
    };
  });

  // What the excess would actually return: FIFO lots, real PSX brokerage, CGT
  // at your filer rate. Computed only for rows that free shares — usually none
  // or one — so the common path costs nothing.
  const needEconomics = rows.filter((r) => r.sellableShares > 0 && r.price != null);
  if (needEconomics.length > 0) {
    const txs = await getAllTransactions().catch(() => []);
    for (const r of needEconomics) {
      const mine = (txs as any[]).filter((t) => t.symbol === r.symbol);
      if (mine.length === 0) continue;
      const { openLots } = buildLots(r.symbol, mine as any);
      const price = r.price as number;
      const pv = previewSell(openLots, r.sellableShares, price, cgtRatePct);
      if (pv.insufficient) continue; // lots disagree with the position — say nothing
      const proceeds = r.sellableShares * price;
      const fees = computePSXFees({ shares: r.sellableShares, price, type: "SELL" }).fee;
      r.sell = {
        shares: r.sellableShares,
        price,
        proceeds,
        fees,
        gain: pv.totalGain,
        cgt: pv.estCgt,
        net: proceeds - fees - pv.estCgt,
        cgtRatePct,
        remainingShares: r.sharesHeld - r.sellableShares,
      };
    }
  }

  return {
    rows,
    buys: rows.filter((r) => r.status === "buy"),
    sells: rows.filter((r) => r.sellableShares > 0),
    heldAtCore: rows.filter((r) => r.status === "sell" && r.sellableShares === 0 && r.sharesHeld > 0),
    conflicts: rows.filter((r) => r.status === "conflict"),
    unpriced: rows.filter((r) => r.price == null).map((r) => r.symbol),
  };
}

export type DeploymentPlan = DeployPlan & {
  board: ZoneBoard;
  standIns: StandInView[];
  candidates: DeployCandidate[]; // what the browser calculator re-runs on
  fundsLabel: string;
  // Warnings the browser cannot regenerate: it re-runs planDeployment on the
  // candidates, so it reproduces that model's own warnings but knows nothing
  // about stale quotes, stand-in problems or where the cash came from.
  serverWarnings: string[];
};

// What to buy right now, and what stays put. Every name with a target weight is
// a candidate — zone status weights it rather than gating it, so a stock just
// above its band still gets bought, only less. Sell candidates are reported by
// the board but their proceeds are deliberately NOT added to the budget: a sale
// is not a fact until it goes through the decision gate, and budgeting unsold
// shares would be spending money you do not have yet.
// Everything the allocator needs, gathered once. Split out because the Plan
// page asks the same question with a different budget: the ladder decides HOW
// MUCH goes out today, this decides WHICH names it buys, and the two must be
// looking at one set of candidates or they will contradict each other.
export type DeployContext = {
  candidates: DeployCandidate[];
  board: ZoneBoard;
  summary: Awaited<ReturnType<typeof getPortfolioSummary>>;
  funds: Awaited<ReturnType<typeof getMutualFundsValued>>;
  fundsValue: number;
  settings: any;
  standIns: { groups: StandInView[]; problems: string[] };
  cashSummary: Awaited<ReturnType<typeof getCashSummary>> | null;
};

async function _buildDeployContext(): Promise<DeployContext> {
  const [board, summary, funds, settings, standIns, cashSummary] = await Promise.all([
    getZoneBoard(),
    getPortfolioSummary(),
    getMutualFundsValued().catch(() => []),
    getAppSettings(),
    getStandInGroups().catch(() => ({ groups: [] as StandInView[], problems: [] as string[] })),
    getCashSummary().catch(() => null),
  ]);
  // A stand-in and the name it holds a place for are ONE allocation. Judged
  // apart, the stand-in looks unsized and the primary looks permanently
  // underweight, and the plan would keep buying a share already ruled too dear.
  const pairOf = new Map<string, StandInView>();
  for (const g of standIns.groups) {
    pairOf.set(g.standIn, g);
    pairOf.set(g.primary, g);
  }
  const fundsValue = funds.reduce((s, f) => s + (f.value ?? 0), 0);
  const zoneBySymbol = new Map(board.rows.map((r) => [r.symbol, r]));

  // Positions you already hold, plus anything watchlisted, all judged by price.
  const seen = new Set<string>();
  const candidates: DeployCandidate[] = [];
  const consider = (symbol: string, price: number | null, targetPct: number, currentValue: number, stale: boolean) => {
    if (seen.has(symbol)) return;
    seen.add(symbol);
    if (price == null || !(price > 0) || stale) return;
    const z = zoneBySymbol.get(symbol);
    // Not on the watchlist at all: no band to judge it by, so it is bought at
    // the reduced no-zone weight rather than skipped or trusted.
    let factor = z ? z.buyFactor : NO_ZONE_FACTOR;
    let reason = z ? z.buyReason : "not on your watchlist — no band to judge it by";
    let effTargetPct = targetPct;
    let effCurrentValue = currentValue;
    const pair = pairOf.get(symbol);
    if (pair) {
      // Both legs are measured against the pair's single target and what is
      // already sitting in it, whichever leg is being sized.
      effTargetPct = pair.targetPct;
      effCurrentValue = pair.combinedValue;
      if (pair.standIn === symbol && pair.swapReady) {
        // The primary is in range: this position is about to be sold to fund
        // it, so adding to it now would be buying what you are selling.
        factor = 0;
        reason = `standing in for ${pair.primary}, which is now in its buy band — sell, do not add`;
      } else if (pair.standIn === symbol) {
        reason = `standing in for ${pair.primary} while it is above its band — ${reason}`;
      }
    }
    candidates.push({ symbol, price, targetPct: effTargetPct, currentValue: effCurrentValue, zoneFactor: factor, zoneReason: reason });
  };
  for (const r of board.rows) {
    consider(r.symbol, r.price, r.targetPct, r.positionValue, r.priceStale);
  }
  for (const p of summary.positions) {
    if (p.targetPercent > 0 || p.shares > 0) {
      consider(p.symbol, p.priceKnown ? p.currentPrice : null, p.targetPercent, p.marketValue, false);
    }
  }

  return { candidates, board, summary, funds, fundsValue, settings, standIns, cashSummary };
}

const buildDeployContext = cache(_buildDeployContext);

async function _getDeploymentPlan(): Promise<DeploymentPlan> {
  const { candidates, board, summary, funds, fundsValue, settings, standIns, cashSummary } =
    await buildDeployContext();

  const plan = planDeployment({
    candidates,
    equityValue: summary.totalValue,
    fundsValue,
    // The brokerage balance can fund an order again, now that it is walked in
    // date order, floored at zero and has tax taken out of sale proceeds. It is
    // still DERIVED, so where it leans on deposits nobody recorded the plan says
    // so below rather than presenting it as counted money.
    brokerCash: cashSummary?.balance ?? 0,
    reservePct: (settings as any).mfCashReservePct ?? 5,
    concentrationCap: (settings as any).concentrationCap ?? 25,
    unpriced: board.unpriced,
  });
  const serverWarnings: string[] = [];
  if (cashSummary && cashSummary.impliedDeposits > 0) {
    serverWarnings.push(
      `Rs ${Math.round(cashSummary.impliedDeposits).toLocaleString()} of the cash balance is assumed, not recorded: spending ran past the deposits in the ledger ${cashSummary.topUps.length} time(s), so a deposit is taken to have happened each time. Check it against a bank statement before sizing an order on it.`
    );
  }
  if (cashSummary && cashSummary.cgtWithheld > 0) {
    serverWarnings.push(
      `Rs ${Math.round(cashSummary.cgtWithheld).toLocaleString()} of capital gains tax is held back out of sale proceeds, so it is not offered here as money to deploy.`
    );
  }
  const staleBuys = board.rows.filter((r) => r.priceStale).map((r) => r.symbol);
  if (staleBuys.length > 0) {
    serverWarnings.push(
      `Skipped on stale prices: ${staleBuys.join(", ")}. The last quote is a week or more old, so the band cannot be trusted — refresh prices first.`
    );
  }
  for (const problem of standIns.problems) serverWarnings.push(problem);
  for (const g of standIns.groups) for (const w of g.warnings) serverWarnings.push(w);
  for (const w of serverWarnings) plan.warnings.push(w);
  return {
    ...plan,
    board,
    standIns: standIns.groups,
    candidates,
    fundsLabel: funds.length === 1 ? funds[0].name : funds.length > 1 ? `${funds.length} funds` : "your fund",
    serverWarnings,
  };
}


// --- Stand-ins: a peer holding a place until the name you want is in range --
// The pair shares one target weight, so the allocator stops treating the
// stand-in as an unsized stray and the primary as permanently underweight.

export type StandInView = StandInGroup & {
  primaryName: string;
  standInName: string;
  primaryPrice: number | null;
  standInPrice: number | null;
  primaryShares: number;
  standInShares: number;
  primaryZone: ZoneStatus;
  primaryBuyZoneLow: number | null;
  primaryBuyZoneHigh: number | null;
};

async function _getStandInGroups(): Promise<{ groups: StandInView[]; problems: string[] }> {
  if (!(await tryConnect())) return { groups: [], problems: [] };
  const holdings = await getAllHoldings();
  const links = holdings
    .map((h) => ({ standIn: h.symbol, primary: String((h as any).standsInFor ?? "").toUpperCase() }))
    .filter((l) => l.primary.length > 0);
  if (links.length === 0) return { groups: [], problems: [] };

  const problems = validateLinks(links);
  const [summary, board, settings] = await Promise.all([
    getPortfolioSummary(),
    getZoneBoard().catch(() => null),
    getAppSettings(),
  ]);
  const posBy = new Map(summary.positions.map((p) => [p.symbol, p]));
  const zoneBy = new Map((board?.rows ?? []).map((r) => [r.symbol, r]));
  const cgtRatePct =
    (settings as any).filerStatus === "filer" ? (settings as any).cgtRateFiler : (settings as any).cgtRateNonFiler;

  const groups: StandInView[] = [];
  for (const link of links) {
    const p = posBy.get(link.primary);
    const s = posBy.get(link.standIn);
    if (!p) {
      problems.push(`${link.standIn} stands in for ${link.primary}, which is not in your portfolio. Add it to the plan first.`);
      continue;
    }
    if (!s) continue;
    const z = zoneBy.get(link.primary);

    // What the stand-in would realise, matched FIFO against its own lots, so
    // the swap is sized on money that would actually arrive. Best-effort: no
    // lots, no guessed tax.
    let gain: number | null = null;
    if (s.shares > 0 && s.priceKnown) {
      try {
        const txs = await getTransactionsBySymbol(link.standIn);
        const { openLots } = buildLots(link.standIn, txs as any);
        const pv = previewSell(openLots, Math.floor(s.shares), s.currentPrice, cgtRatePct);
        if (!pv.insufficient) gain = pv.totalGain;
      } catch {
        /* lots unavailable — the swap reports an unknown gain rather than zero */
      }
    }

    const group = resolveStandIn({
      primary: {
        symbol: p.symbol,
        sector: p.sector,
        price: p.priceKnown ? p.currentPrice : null,
        shares: p.shares,
        marketValue: p.marketValue,
        targetPct: p.targetPercent,
      },
      standIn: {
        symbol: s.symbol,
        sector: s.sector,
        price: s.priceKnown ? s.currentPrice : null,
        shares: s.shares,
        marketValue: s.marketValue,
        targetPct: s.targetPercent,
      },
      primaryInBuyZone: z?.status === "buy" && !z.priceStale,
      bookValue: summary.totalValue,
      gain,
      cgtRatePct,
    });

    groups.push({
      ...group,
      primaryName: p.name,
      standInName: s.name,
      primaryPrice: p.priceKnown ? p.currentPrice : null,
      standInPrice: s.priceKnown ? s.currentPrice : null,
      primaryShares: p.shares,
      standInShares: s.shares,
      primaryZone: z?.status ?? "no_zone",
      primaryBuyZoneLow: z?.buyZoneLow ?? null,
      primaryBuyZoneHigh: z?.buyZoneHigh ?? null,
    });
  }
  return { groups, problems: [...new Set(problems)] };
}

export const getStandInGroups = cache(_getStandInGroups);

export const getZoneBoard = cache(_getZoneBoard);
export const getDeploymentPlan = cache(_getDeploymentPlan);

// The ladder says HOW MUCH goes out today. This says which names it buys.
//
// Before this existed the two halves of the plan never met: the ladder printed
// "deploy Rs 52,758" and stopped, leaving the one question that actually costs
// money — which shares, how many — to be answered from memory at the moment of
// buying, which is exactly the moment the rules exist to protect you from.
//
// The budget is passed as FRESH cash with no reserve of its own, because the
// ladder has already taken its reserve out of the pool. Charging a second
// reserve here would quietly shrink every rung. Equity value is still real, so
// target weights and the concentration cap bind against the actual book.
export async function getLadderBuys(budget: number): Promise<DeployPlan | null> {
  if (!(budget > 0)) return null;
  const { candidates, summary, settings, board } = await buildDeployContext();
  if (candidates.length === 0) return null;
  return planDeployment({
    candidates,
    equityValue: summary.totalValue,
    fundsValue: 0,
    brokerCash: 0,
    reservePct: 0,
    concentrationCap: (settings as any).concentrationCap ?? 25,
    freshCash: budget,
    unpriced: board.unpriced,
  });
}
