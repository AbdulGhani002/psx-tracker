import "server-only";
import { cache } from "react";
import { connectDb } from "./db";
import { getCurrentUserId } from "./auth/current-user";
import { knownHoldingCompany } from "./holding-companies";
import {
  HoldingModel,
  TransactionModel,
  TargetAllocationModel,
  DecisionLogModel,
  ScenarioProjectionModel,
  CashEntryModel,
  WatchlistEntryModel,
  SbpRateModel,
  MutualFundModel,
  SavingsAccountModel,
  AppSettingsModel,
  CommodityTradeModel,
  FundamentalModel,
  FeedSnapshotModel,
  UserModel,
  DEFAULT_SETTINGS,
  type Holding,
  type Transaction,
} from "./models";
import { fetchFundamentals } from "./prices/fundamentals";
import { fetchPayouts } from "./prices/payouts";
import type { FundamentalsInput } from "./calculations/dividend-forecast";
import { SBP_POLICY_RATE_DEFAULTS, policyRateOn, type RateStep } from "./timeseries/sbp-rate";
import { fetchSbpRates, corridorAgrees, tbill12mPct, type SbpRates } from "./feeds/sbp";
import { fetchInflation, type InflationData } from "./feeds/inflation";
import { buildLadder, type Ladder } from "./calculations/ladder";
import { computeAttribution, type Attribution } from "./calculations/attribution";
import { isFiler as pkIsFiler } from "./calculations/pk-tax";
import { fetchAllNavs, findNav, fetchFundReturns } from "./funds/mufap";
import { valueSavings, valueFund, type SavingsValuation, type FundValuation } from "./calculations/assets";
import { buildTaxReport, type TaxReport } from "./calculations/tax";
import { buildLots, summariseCgt, type Disposal, type CgtSummary, type Lot } from "./calculations/lots";
import { computeRisk, type RiskMetrics } from "./calculations/risk";
import { valueTrade, type TradeValuation } from "./calculations/pmex";
import { buildBenchmarkSeries } from "./timeseries/portfolio-history";
import { fetchEodSeries } from "./timeseries/psx-eod";
import { getPrices } from "./prices";
import {
  summarisePortfolio,
  computeCashBalance,
  type PortfolioSummary,
  type CashSummary,
} from "./calculations";
import { forecastDividends, type DividendForecast } from "./calculations/dividend-forecast";
import { computeSotp, deriveSharesOutstanding, type SotpResult } from "./calculations/sotp";
import { computeIntrinsic, intrinsicSensitivity, normalizedEps, robustGrowthPct, sectorFairPE, type IntrinsicInputs, type IntrinsicResult, type Sensitivity } from "./calculations/intrinsic";
import { analyzeConcentration, analyzeCorrelation, type ConcentrationResult, type CorrelationResult } from "./calculations/risk-analysis";
import { fetchManyEod } from "./timeseries/psx-eod";
import { fetchMarketWatch, indexLabel, isInIndex } from "./prices/marketwatch";
import { taxYearOf } from "./dates";
import { compareSectors, type SectorComparison } from "./calculations/sector-weights";
import type { SectorWeightsSnapshot } from "./feeds/sector-weights";

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

// Stored par (face) values for a set of symbols — read-only, no PSX fetching,
// so market-wide pages (the dividend calendar) can use real pars where we have
// them without triggering hundreds of scrapes. Missing symbols are simply
// absent; callers fall back to the Rs 10 PSX standard and say so.
export async function getFaceValues(symbols: string[]): Promise<Record<string, number>> {
  if (!(await tryConnect())) return {};
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];
  if (upper.length === 0) return {};
  const rows: any[] = await FundamentalModel.find({ symbol: { $in: upper } }, { symbol: 1, faceValue: 1 }).lean();
  const out: Record<string, number> = {};
  for (const r of rows) if (r.faceValue != null && r.faceValue > 0) out[r.symbol] = r.faceValue;
  return out;
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
    cash: (nw as any)?.cash ?? 0,
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

// Your sector mix vs the KSE-100's, served from the stored snapshot (instant).
// "Your" side is computed live from current holdings (cheap); the index side is
// the precomputed market-cap weighting.
export async function getSectorComparison(): Promise<SectorComparisonResult> {
  const [snap, summary] = await Promise.all([
    getFeedSnapshot<SectorWeightsSnapshot>("kse100SectorWeights"),
    getPortfolioSummary().catch(() => null),
  ]);

  const yours = (summary?.positions ?? [])
    .filter((p) => p.marketValue > 0)
    .map((p) => ({ sector: p.sector || "Unclassified", value: p.marketValue }));
  const yourEquityValue = yours.reduce((s, y) => s + y.value, 0);

  const indexSectors = snap.data?.sectors ?? [];
  const comparison = compareSectors(yours, indexSectors);

  return {
    comparison,
    index: snap.data?.index ?? "KSE100",
    asOf: snap.data?.asOf ?? null,
    updatedAt: snap.updatedAt,
    status: snap.status,
    note: snap.note,
    membersPriced: snap.data?.priced ?? 0,
    membersTotal: snap.data?.members ?? 0,
    yourEquityValue,
  };
}

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

// Look-through breakdowns for every holding company in the portfolio (anything
// with look-through configured). Powers the "How it's valued" methodology page.
export async function getAllLookThroughs(): Promise<LookThrough[]> {
  if (!(await tryConnect())) return [];
  const holdings = await HoldingModel.find({ userId: await meId(), "lookThrough.enabled": true }).lean();
  const out = await Promise.all(
    holdings.map((h: any) => getLookThroughFor(h.symbol).catch(() => null))
  );
  return out
    .filter((x): x is LookThrough => x != null && x.navPerShare > 0)
    .sort((a, b) => b.yourMarketValue - a.yourMarketValue);
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

export async function getTargetAllocations() {
  if (!(await tryConnect())) return [];
  const docs = await TargetAllocationModel.find({ userId: await meId() }).lean();
  return plain<Array<{ _id: string; symbol: string; targetPercent: number; rebalanceBand: number; rationale: string }>>(docs);
}

export async function getDecisionLog(symbol?: string) {
  if (!(await tryConnect())) return [];
  const filter: Record<string, unknown> = { userId: await meId() };
  if (symbol) filter.symbol = symbol.toUpperCase();
  const docs = await DecisionLogModel.find(filter).sort({ date: -1 }).lean();
  return plain<Array<{ _id: string; symbol: string; date: string; trigger: string; interpretation: string; action: string; positionBefore: number; positionAfter: number }>>(docs);
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
    };
  }
  const [entries, txs] = await Promise.all([
    CashEntryModel.find({ userId: await meId() }).lean(),
    TransactionModel.find({ userId: await meId(), deletedAt: null }).lean(),
  ]);
  return computeCashBalance(txs as any, entries as any);
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

// Headline YoY CPI, or null when PBS is unreachable and we have nothing stored.
// Callers MUST handle null by saying "needs a feed" — never by substituting 0,
// which silently turns a real return into a nominal one.
async function _getInflationPct(): Promise<number | null> {
  if (!(await tryConnect())) return null;
  return (await getInflationLive())?.yoyPct ?? null;
}
export const getInflationPct = cache(_getInflationPct);

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

// Everything the next-rupee ladder needs, assembled from live feeds and the
// user's own instruments. Equity earnings/dividend yield is VALUE-WEIGHTED over
// the user's priced holdings that the analytics service covers; if none match,
// the equity rung is omitted (with a reason) rather than guessed.
async function _getLadderData(): Promise<{
  ladder: Ladder;
  inflationSource: "manual" | "pbs" | "none";
  inflationPeriod: string | null;
  filer: boolean;
  sbpAsOf: string | null;
}> {
  const [sbp, inf, settings, funds, savings, summary] = await Promise.all([
    getSbpLive(),
    getEffectiveInflationPct(),
    getAppSettings(),
    getMutualFundsValued(),
    getSavingsValued(),
    getPortfolioSummary(),
  ]);

  let equity: { label: string; earningsYieldPct: number; dividendYieldPct: number } | null = null;
  try {
    const { getRatings } = await import("./analytics");
    const ratings = await getRatings(500);
    const by = new Map((ratings?.results ?? []).map((r) => [r.symbol.toUpperCase(), r]));
    let wEy = 0, wDy = 0, wTot = 0;
    for (const p of summary.positions) {
      if (p.shares <= 0 || !p.priceKnown) continue;
      const r = by.get(p.symbol.toUpperCase());
      if (!r || r.earnings_yield_pct == null) continue;
      wEy += r.earnings_yield_pct * p.marketValue;
      wDy += (r.dividend_yield_pct ?? 0) * p.marketValue;
      wTot += p.marketValue;
    }
    if (wTot > 0) {
      equity = { label: "Your equities", earningsYieldPct: wEy / wTot, dividendYieldPct: wDy / wTot };
    }
  } catch {
    /* analytics down -> equity rung omitted, never guessed */
  }

  const rates = sbp?.rates ?? null;
  const ladder = buildLadder({
    inflationPct: inf.pct,
    settings: settings as any,
    tbill12mPct: tbill12mPct(rates),
    policyRatePct: rates?.policyRatePct ?? null,
    kibor12BidPct: rates?.kibor.find((k) => k.tenor === "12M")?.bid ?? null,
    funds: funds
      .map((f) => ({ name: f.name, yieldPct: f.liveAnnualYieldPct ?? f.annualYieldPct }))
      .filter((f) => f.yieldPct > 0),
    savings: savings
      .map((a) => ({ name: a.name, ratePercent: a.ratePercent }))
      .filter((a) => a.ratePercent > 0),
    equity,
  });
  return {
    ladder,
    inflationSource: inf.source,
    inflationPeriod: inf.period,
    filer: pkIsFiler(settings as any),
    sbpAsOf: rates?.fetchedAt?.slice(0, 10) ?? null,
  };
}
export const getLadderData = cache(_getLadderData);

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
    const v = valueFund(
      { units: f.units, avgCost: f.avgCost, dailyDividend, annualYieldPct: accrualYieldPct, anchorDate: (f as any).anchorDate ?? "" },
      nav
    );
    out.push({
      ...v, // units, nav, effectiveNav, dailyYieldPct, value, cost, unrealizedPL, unrealizedPct, dailyDividend
      _id: String(f._id),
      name: f.name,
      mufapName: f.mufapName,
      amc: f.amc,
      avgCost: f.avgCost,
      fundType: (f as any).fundType ?? "growth",
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
  cash: number; // brokerage cash balance
  total: number;
  breakdown: { label: string; value: number }[];
};

async function _getNetWorth(): Promise<NetWorth> {
  const [summary, funds, savings, cash] = await Promise.all([
    getPortfolioSummary(),
    getMutualFundsValued(),
    getSavingsValued(),
    getCashSummary(),
  ]);
  const equity = summary.totalValue;
  const fundsTotal = funds.reduce((s, f) => s + f.value, 0);
  const savingsTotal = savings.reduce((s, a) => s + a.balance, 0);
  const cashTotal = Math.max(0, cash.balance);
  const total = equity + fundsTotal + savingsTotal + cashTotal;
  return {
    equity,
    funds: fundsTotal,
    savings: savingsTotal,
    cash: cashTotal,
    total,
    breakdown: [
      { label: "PSX equities", value: equity },
      { label: "Mutual funds", value: fundsTotal },
      { label: "Savings", value: savingsTotal },
      { label: "Cash", value: cashTotal },
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
    equityRiskPremiumPct: (doc as any)?.equityRiskPremiumPct ?? DEFAULT_SETTINGS.equityRiskPremiumPct,
    defaultFairPE: (doc as any)?.defaultFairPE ?? DEFAULT_SETTINGS.defaultFairPE,
    targetMonthlyIncome: (doc as any)?.targetMonthlyIncome ?? DEFAULT_SETTINGS.targetMonthlyIncome,
    telegramBotToken: (doc as any)?.telegramBotToken ?? "",
    telegramChatId: (doc as any)?.telegramChatId ?? "",
    alertsEnabled: (doc as any)?.alertsEnabled ?? false,
  } as AppSettings;
}

export async function getTaxReport(): Promise<TaxReport> {
  const [txs, summary, settings] = await Promise.all([
    getAllTransactions(),
    getPortfolioSummary(),
    getAppSettings(),
  ]);
  return buildTaxReport(txs, summary.realizedPL, settings);
}

export type CgtReport = {
  summary: CgtSummary;
  recentDisposals: Disposal[];
  rate: number;
};

export async function getCgtReport(): Promise<CgtReport> {
  const [txs, settings] = await Promise.all([getAllTransactions(), getAppSettings()]);
  const bySymbol = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  const allDisposals: Disposal[] = [];
  for (const [sym, list] of bySymbol) {
    const { disposals } = buildLots(sym, list);
    allDisposals.push(...disposals);
  }
  allDisposals.sort((a, b) => b.soldDate.localeCompare(a.soldDate));
  const rate = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const summary = summariseCgt(allDisposals, rate);
  return { summary, recentDisposals: allDisposals.slice(0, 25), rate };
}

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

export async function getHarvestReport(): Promise<HarvestReport> {
  const [txs, settings] = await Promise.all([getAllTransactions(), getAppSettings()]);
  const bySymbol = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  const symbols = [...bySymbol.keys()];
  const prices = await getCurrentPrices(symbols);

  const rate = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const thisTaxYear = (await import("./dates")).taxYearOf(new Date()).endYear;

  const candidates: HarvestCandidate[] = [];
  let realizedGainThisYear = 0;
  for (const [sym, list] of bySymbol) {
    const { openLots, disposals } = buildLots(sym, list);
    for (const d of disposals) {
      const ty = (await import("./dates")).taxYearOf(d.soldDate).endYear;
      if (ty === thisTaxYear) realizedGainThisYear += d.gain;
    }
    const shares = openLots.reduce((s, l) => s + l.shares, 0);
    if (shares <= 0) continue;
    const cost = openLots.reduce((s, l) => s + l.shares * l.costPerShare, 0);
    const price = prices.get(sym) ?? 0;
    const marketValue = shares * price;
    const unrealized = marketValue - cost;
    if (unrealized < 0 && price > 0) {
      candidates.push({
        symbol: sym,
        shares,
        avgCost: shares > 0 ? cost / shares : 0,
        currentPrice: price,
        marketValue,
        cost,
        unrealizedLoss: unrealized,
      });
    }
  }
  candidates.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss);
  const totalHarvestableLoss = candidates.reduce((s, c) => s + c.unrealizedLoss, 0);
  const offsetPotential = Math.min(Math.abs(totalHarvestableLoss), Math.max(0, realizedGainThisYear));
  return {
    candidates,
    totalHarvestableLoss,
    realizedGainThisYear,
    offsetPotential,
    cgtSaved: (offsetPotential * rate) / 100,
    rate,
  };
}

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

// "If you sold everything today": per open position, the holding period and the
// CGT you'd owe on the gain at your current rate — plus how many days are left
// in the FBR tax year (ends 30 June) to harvest losses against this year's gains.
export async function getSellTodayCgt(): Promise<{
  rows: SellTodayRow[];
  totalGain: number;
  totalCgt: number;
  rate: number;
  daysToYearEnd: number;
  yearEnd: string;
}> {
  const [txs, settings] = await Promise.all([getAllTransactions(), getAppSettings()]);
  const rate = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const bySymbol = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  const prices = await getCurrentPrices([...bySymbol.keys()]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const dayMs = 86400000;
  const daysHeld = (acq: string) => Math.max(0, Math.round((new Date(todayIso).getTime() - new Date(acq).getTime()) / dayMs));

  const rows: SellTodayRow[] = [];
  for (const [sym, list] of bySymbol) {
    const { openLots } = buildLots(sym, list);
    const shares = openLots.reduce((s, l) => s + l.shares, 0);
    if (shares <= 1e-6) continue;
    const price = prices.get(sym) ?? 0;
    if (price <= 0) continue;
    const cost = openLots.reduce((s, l) => s + l.shares * l.costPerShare, 0);
    const marketValue = shares * price;
    const gain = marketValue - cost;
    const weightedDays = openLots.reduce((s, l) => s + l.shares * daysHeld(l.acquired), 0) / shares;
    const longTermShares = openLots.filter((l) => daysHeld(l.acquired) > 365).reduce((s, l) => s + l.shares, 0);
    rows.push({
      symbol: sym,
      shares,
      avgCost: cost / shares,
      price,
      marketValue,
      cost,
      gain,
      gainPct: cost > 0 ? gain / cost : 0,
      weightedDays,
      longTermShares,
      cgtIfSold: gain > 0 ? (gain * rate) / 100 : 0,
    });
  }
  rows.sort((a, b) => b.marketValue - a.marketValue);

  // Days to the FBR tax-year end (30 June).
  const now = new Date(todayIso);
  let ye = new Date(Date.UTC(now.getUTCFullYear(), 5, 30)); // 30 June this year
  if (now.getTime() > ye.getTime()) ye = new Date(Date.UTC(now.getUTCFullYear() + 1, 5, 30));
  const daysToYearEnd = Math.max(0, Math.round((ye.getTime() - now.getTime()) / dayMs));

  return {
    rows,
    totalGain: rows.reduce((s, r) => s + r.gain, 0),
    totalCgt: rows.reduce((s, r) => s + r.cgtIfSold, 0),
    rate,
    daysToYearEnd,
    yearEnd: ye.toISOString().slice(0, 10),
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
} & TradeValuation;

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
      ...v,
    };
  });
  return { trades, settings };
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
  return plain<Array<{ _id: string; symbol: string; name: string; sector: string; notes: string; targetBuyPrice: number | null; targetSellPrice: number | null; createdAt: string }>>(docs);
}

export async function getScenariosForSymbol(symbol: string | null) {
  if (!(await tryConnect())) return [];
  const docs = await ScenarioProjectionModel.find({ userId: await meId(), symbol }).lean();
  return plain<Array<{ _id: string; name: string; symbol: string | null; assumptions: { annualGrowthRate: number; endingPE: number; payoutRatio: number; horizonYears: number; useDRIP: boolean; customNotes: string } }>>(docs);
}

export const checkDataAvailability = cache(_checkDataAvailability);

export const getAllTransactions = cache(_getAllTransactions);

export const getPortfolioSummary = cache(_getPortfolioSummary);

export const getNetWorth = cache(_getNetWorth);

export const getAppSettings = cache(_getAppSettings);

export const getRiskMetrics = cache(_getRiskMetrics);

export const getTodaysMovers = cache(_getTodaysMovers);

export const getIntrinsicValuations = cache(_getIntrinsicValuations);

export const getAllHoldings = cache(_getAllHoldings);
// These three were each running TWICE per request: the page calls them and
// getNetWorth() calls them again. getMutualFundsValued is also the most
// expensive of the set (a Mongo round-trip per fund), so the duplicate hurt.
export const getCashSummary = cache(_getCashSummary);
export const getMutualFundsValued = cache(_getMutualFundsValued);
export const getSavingsValued = cache(_getSavingsValued);
