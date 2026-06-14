import "server-only";
import { connectDb } from "./db";
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
  DEFAULT_SETTINGS,
  type Holding,
  type Transaction,
} from "./models";
import { fetchFundamentals } from "./prices/fundamentals";
import { fetchPayouts } from "./prices/payouts";
import type { FundamentalsInput } from "./calculations/dividend-forecast";
import { SBP_POLICY_RATE_DEFAULTS, policyRateOn, type RateStep } from "./timeseries/sbp-rate";
import { fetchAllNavs, findNav } from "./funds/mufap";
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
import { computeValuation, type Valuation } from "./calculations/valuation";
import { analyzeConcentration, analyzeCorrelation, type ConcentrationResult, type CorrelationResult } from "./calculations/risk-analysis";
import { fetchManyEod } from "./timeseries/psx-eod";

function plain<T>(v: unknown): T {
  return JSON.parse(JSON.stringify(v));
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

export async function checkDataAvailability(): Promise<DataAvailability> {
  const ok = await tryConnect();
  return ok ? { available: true } : { available: false, reason: lastConnectionError ?? "unknown" };
}

export async function getAllHoldings(): Promise<Holding[]> {
  if (!(await tryConnect())) return [];
  const docs = await HoldingModel.find().sort({ symbol: 1 }).lean();
  return plain<Holding[]>(docs);
}

export async function getHoldingBySymbol(symbol: string): Promise<Holding | null> {
  if (!(await tryConnect())) return null;
  const doc = await HoldingModel.findOne({ symbol: symbol.toUpperCase() }).lean();
  return doc ? plain<Holding>(doc) : null;
}

export async function getAllTransactions(): Promise<Transaction[]> {
  if (!(await tryConnect())) return [];
  // { deletedAt: null } also matches legacy docs that predate the field.
  const docs = await TransactionModel.find({ deletedAt: null }).sort({ date: -1, createdAt: -1 }).lean();
  return plain<Transaction[]>(docs);
}

export async function getTransactionsBySymbol(symbol: string): Promise<Transaction[]> {
  if (!(await tryConnect())) return [];
  const docs = await TransactionModel.find({ symbol: symbol.toUpperCase(), deletedAt: null })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  return plain<Transaction[]>(docs);
}

// Soft-deleted transactions only — powers the Trash view.
export async function getDeletedTransactions(): Promise<Transaction[]> {
  if (!(await tryConnect())) return [];
  const docs = await TransactionModel.find({ deletedAt: { $ne: null } })
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

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
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
            annual: fresh?.annual ?? prev?.annual ?? [],
            latestEps: fresh?.latestEps ?? prev?.latestEps ?? null,
            epsGrowthPct: fresh?.epsGrowthPct ?? prev?.epsGrowthPct ?? null,
            payouts: payouts != null
              ? payouts.map((p) => ({ date: p.announceDate ?? p.bookClosureStart, pctOfFace: p.pctOfFace, cycle: p.cycle, payoutType: p.payoutType }))
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

export async function getDividendForecast(): Promise<DividendForecast> {
  const [holdings, transactions] = await Promise.all([getAllHoldings(), getAllTransactions()]);
  const held = holdings.filter((h) => h.currentShares > 0).map((h) => h.symbol);
  const [prices, fundamentals] = await Promise.all([getCurrentPrices(held), getFundamentals(held)]);
  const priceMap: Record<string, number> = {};
  for (const [k, v] of prices) priceMap[k] = v;
  return forecastDividends(transactions, holdings, { fundamentals, prices: priceMap });
}

export type HoldingValuation = Valuation & {
  symbol: string;
  name: string;
  price: number;
  eps: number | null;
  bookValuePerShare: number;
  shares: number;
  marketValue: number;
};

// Valuation across all held stocks. EPS from cached fundamentals, forward
// dividend + growth from the forecast, book value from the (editable) holding
// field, required return from the live SBP rate + your equity-premium setting.
export async function getValuations(): Promise<{ valuations: HoldingValuation[]; requiredReturnPct: number; fairPE: number; sbpRatePct: number }> {
  const [holdings, settings, sbp] = await Promise.all([getAllHoldings(), getAppSettings(), getSbpRateSteps()]);
  const held = holdings.filter((h) => h.currentShares > 0);
  const fairPE = (settings as any).defaultFairPE ?? 8;
  const sbpRatePct = policyRateOn(new Date().toISOString().slice(0, 10), sbp.steps) ?? 11;
  const requiredReturnPct = sbpRatePct + ((settings as any).equityRiskPremiumPct ?? 6);
  if (!held.length) return { valuations: [], requiredReturnPct, fairPE, sbpRatePct };

  const syms = held.map((h) => h.symbol);
  const [prices, funds, forecast] = await Promise.all([getCurrentPrices(syms), getFundamentals(syms), getDividendForecast()]);
  const profBySym = new Map(forecast.profiles.map((p) => [p.symbol, p]));

  const valuations = held
    .map((h) => {
      const price = prices.get(h.symbol) ?? 0;
      const eps = funds[h.symbol]?.latestEps ?? null;
      const prof = profBySym.get(h.symbol);
      const forwardDps = prof?.forwardDpsAnnual ?? 0;
      const dividendGrowthPct = prof?.dividendGrowthPct ?? funds[h.symbol]?.epsGrowthPct ?? 0;
      const bookValuePerShare = (h as any).bookValuePerShare ?? 0;
      const v = computeValuation({ price, eps, forwardDps, dividendGrowthPct, bookValuePerShare, requiredReturnPct, fairPE });
      return { symbol: h.symbol, name: h.name, price, eps, bookValuePerShare, shares: h.currentShares, marketValue: price * h.currentShares, ...v };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  return { valuations, requiredReturnPct, fairPE, sbpRatePct };
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

export type LookThrough = SotpResult & { symbol: string; name: string };

// Look-through (sum-of-the-parts) valuation for a single holding company.
// Stakes are from the holding config; constituent + own prices are live;
// shares outstanding derives from financials when not pinned.
export async function getLookThroughFor(symbol: string): Promise<LookThrough | null> {
  if (!(await tryConnect())) return null;
  const sym = symbol.toUpperCase();
  const h = await HoldingModel.findOne({ symbol: sym }).lean();
  const lt = (h as any)?.lookThrough;
  if (!h || !lt?.enabled || !(lt.constituents?.length > 0)) return null;

  const constituents = (lt.constituents as Array<{ label: string; symbol: string; shares: number }>).filter((c) => c.symbol);
  const symbols = [...new Set([sym, ...constituents.map((c) => c.symbol.toUpperCase())])];
  const prices = await getCurrentPrices(symbols);
  const priceObj: Record<string, number> = {};
  for (const [k, v] of prices) priceObj[k] = v;

  let shares = lt.sharesOutstanding || 0;
  if (shares <= 0) {
    const f: any = await FundamentalModel.findOne({ symbol: sym }).lean();
    const latest = f?.annual?.[0];
    shares = deriveSharesOutstanding(latest?.profitAfterTax ?? null, latest?.eps ?? null);
  }

  const result = computeSotp({
    constituents: constituents.map((c) => ({ label: c.label, symbol: c.symbol.toUpperCase(), shares: c.shares })),
    prices: priceObj,
    unlistedValuePkr: lt.unlistedValuePkr ?? 0,
    netDebtPkr: lt.netDebtPkr ?? 0,
    sharesOutstanding: shares,
    marketPrice: prices.get(sym) ?? 0,
    heldShares: (h as any).currentShares ?? 0,
  });
  return { symbol: sym, name: (h as any).name ?? sym, ...result };
}

export async function getTargetAllocations() {
  if (!(await tryConnect())) return [];
  const docs = await TargetAllocationModel.find().lean();
  return plain<Array<{ _id: string; symbol: string; targetPercent: number; rebalanceBand: number; rationale: string }>>(docs);
}

export async function getDecisionLog(symbol?: string) {
  if (!(await tryConnect())) return [];
  const filter = symbol ? { symbol: symbol.toUpperCase() } : {};
  const docs = await DecisionLogModel.find(filter).sort({ date: -1 }).lean();
  return plain<Array<{ _id: string; symbol: string; date: string; trigger: string; interpretation: string; action: string; positionBefore: number; positionAfter: number }>>(docs);
}

export async function getCashSummary(): Promise<CashSummary> {
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
    CashEntryModel.find().lean(),
    TransactionModel.find({ deletedAt: null }).lean(),
  ]);
  return computeCashBalance(txs as any, entries as any);
}

export async function getCashEntries() {
  if (!(await tryConnect())) return [];
  const docs = await CashEntryModel.find().sort({ date: -1, createdAt: -1 }).lean();
  return plain<Array<{ _id: string; date: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number; notes: string }>>(docs);
}

// SBP policy-rate steps: the user's DB entries if any exist, else the curated
// built-in defaults. `isCustom` tells the UI which set is active.
export async function getSbpRateSteps(): Promise<{ steps: RateStep[]; isCustom: boolean }> {
  if (!(await tryConnect())) return { steps: SBP_POLICY_RATE_DEFAULTS, isCustom: false };
  const docs = await SbpRateModel.find().sort({ effectiveDate: -1 }).lean();
  if (docs.length === 0) return { steps: SBP_POLICY_RATE_DEFAULTS, isCustom: false };
  return {
    steps: docs.map((d) => ({ from: d.effectiveDate, rate: d.rate })),
    isCustom: true,
  };
}

export async function getSbpRates() {
  if (!(await tryConnect())) return [];
  const docs = await SbpRateModel.find().sort({ effectiveDate: -1 }).lean();
  return plain<Array<{ _id: string; effectiveDate: string; rate: number; note: string }>>(docs);
}

export type ValuedFund = {
  _id: string;
  name: string;
  mufapName: string;
  amc: string;
  units: number;
  avgCost: number;
  notes: string;
  nav: number; // 0 if NAV unavailable
  navFound: boolean;
} & FundValuation;

export async function getMutualFundsValued(): Promise<ValuedFund[]> {
  if (!(await tryConnect())) return [];
  const docs = await MutualFundModel.find().sort({ name: 1 }).lean();
  if (docs.length === 0) return [];
  const navs = await fetchAllNavs();
  const byName = new Map(navs.map((n) => [n.name.toLowerCase(), n.nav]));
  const out: ValuedFund[] = [];
  for (const f of docs) {
    let nav = byName.get(f.mufapName.toLowerCase()) ?? 0;
    if (!nav) {
      const m = await findNav(f.mufapName);
      nav = m?.nav ?? 0;
    }
    const v = valueFund({ units: f.units, avgCost: f.avgCost }, nav);
    out.push({
      ...v, // units, nav, value, cost, unrealizedPL, unrealizedPct
      _id: String(f._id),
      name: f.name,
      mufapName: f.mufapName,
      amc: f.amc,
      avgCost: f.avgCost,
      notes: f.notes,
      navFound: nav > 0,
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

export async function getSavingsValued(): Promise<ValuedSavings[]> {
  if (!(await tryConnect())) return [];
  const docs = await SavingsAccountModel.find().sort({ name: 1 }).lean();
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

export async function getNetWorth(): Promise<NetWorth> {
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

export async function getAppSettings(): Promise<AppSettings> {
  if (!(await tryConnect())) return { ...DEFAULT_SETTINGS };
  const doc = await AppSettingsModel.findOneAndUpdate(
    { key: "global" },
    {},
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

export async function getRiskMetrics(): Promise<RiskMetrics | null> {
  const [txs, { steps }] = await Promise.all([getAllTransactions(), getSbpRateSteps()]);
  const series = await buildBenchmarkSeries({ transactions: txs, rangeKey: "1Y", rateSteps: steps });
  if (!series) return null;
  const portfolio = series.points.map((p) => p.portfolio).filter((x): x is number => x != null);
  const benchmark = series.points.map((p) => p.kse100).filter((x): x is number => x != null);
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
  const docs = await CommodityTradeModel.find().sort({ entryDate: -1 }).lean();
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

export async function getTodaysMovers(): Promise<{ gainers: Mover[]; losers: Mover[] }> {
  const holdings = await getAllHoldings();
  const active = holdings.filter((h) => (h.currentShares ?? 0) > 0);
  const movers: Mover[] = [];
  for (const h of active) {
    try {
      const eod = await fetchEodSeries(h.symbol);
      if (eod.length < 2) continue;
      const price = eod[eod.length - 1].close;
      const prevClose = eod[eod.length - 2].close;
      if (prevClose > 0) {
        movers.push({ symbol: h.symbol, price, prevClose, changePct: price / prevClose - 1 });
      }
    } catch {
      /* skip */
    }
  }
  const sorted = [...movers].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.filter((m) => m.changePct > 0).slice(0, 3),
    losers: sorted.filter((m) => m.changePct < 0).reverse().slice(0, 3),
  };
}

export async function getWatchlist() {
  if (!(await tryConnect())) return [];
  const docs = await WatchlistEntryModel.find().sort({ createdAt: -1 }).lean();
  return plain<Array<{ _id: string; symbol: string; name: string; sector: string; notes: string; targetBuyPrice: number | null; targetSellPrice: number | null; createdAt: string }>>(docs);
}

export async function getScenariosForSymbol(symbol: string | null) {
  if (!(await tryConnect())) return [];
  const docs = await ScenarioProjectionModel.find({ symbol }).lean();
  return plain<Array<{ _id: string; name: string; symbol: string | null; assumptions: { annualGrowthRate: number; endingPE: number; payoutRatio: number; horizonYears: number; useDRIP: boolean; customNotes: string } }>>(docs);
}
