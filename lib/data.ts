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
  DEFAULT_SETTINGS,
  type Holding,
  type Transaction,
} from "./models";
import { SBP_POLICY_RATE_DEFAULTS, policyRateOn, type RateStep } from "./timeseries/sbp-rate";
import { fetchAllNavs, findNav } from "./funds/mufap";
import { valueSavings, valueFund, type SavingsValuation, type FundValuation } from "./calculations/assets";
import { buildTaxReport, type TaxReport } from "./calculations/tax";
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
  const docs = await TransactionModel.find().sort({ date: -1, createdAt: -1 }).lean();
  return plain<Transaction[]>(docs);
}

export async function getTransactionsBySymbol(symbol: string): Promise<Transaction[]> {
  if (!(await tryConnect())) return [];
  const docs = await TransactionModel.find({ symbol: symbol.toUpperCase() })
    .sort({ date: 1, createdAt: 1 })
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
    TransactionModel.find().lean(),
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
  };
}

export async function getTaxReport(): Promise<TaxReport> {
  const [txs, summary, settings] = await Promise.all([
    getAllTransactions(),
    getPortfolioSummary(),
    getAppSettings(),
  ]);
  return buildTaxReport(txs, summary.realizedPL, settings);
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
