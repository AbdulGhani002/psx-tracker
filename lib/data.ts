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
  type Holding,
  type Transaction,
} from "./models";
import { SBP_POLICY_RATE_DEFAULTS, type RateStep } from "./timeseries/sbp-rate";
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
