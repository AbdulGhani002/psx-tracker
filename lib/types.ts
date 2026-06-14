export const TRANSACTION_TYPES = ["BUY", "SELL", "DIVIDEND", "BONUS", "RIGHT", "SPLIT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type Holding = {
  _id: string;
  symbol: string;
  name: string;
  sector: string;
  shariaCompliant: boolean;
  currentShares: number;
  avgCostBasis: number;
  totalCost: number;
  realizedPL: number;
  totalDividendsReceived: number;
  targetAllocationPercent: number;
  rebalanceBand: number;
  targetRationale: string;
  notes: string;
  tier?: string;
  convictionScore?: number;
  goalTag?: string;
  thesis?: string;
  trackedMetrics?: Array<{ name: string; source: string; green: string; red: string; current: string }>;
  modelAssumptions?: {
    mode: string;
    annualGrowth: number;
    peStart: number;
    peEnd: number;
    payoutRatio: number;
    navDiscount: number;
    horizonYears: number;
    useDRIP: boolean;
    saved: boolean;
  };
  // Manual dividend-forecast overrides; 0 / "" means "auto" (use the model).
  dividendOverride?: {
    parValue?: number; // Rs face value
    cadence?: string; // "" | annual | semi-annual | quarterly
    payoutRatioPct?: number; // % of EPS
    expectedAnnualDps?: number; // Rs/share/yr — pins the forward dividend directly
  };
  createdAt: Date | string;
  updatedAt: Date | string;
};

export const HOLDING_TIERS = ["Anchor", "Core", "Satellite", "Starter"] as const;
export const TIER_BANDS: Record<string, { min: number; max: number; cap: number }> = {
  Anchor: { min: 12, max: 18, cap: 25 },
  Core: { min: 7, max: 12, cap: 25 },
  Satellite: { min: 3, max: 7, cap: 10 },
  Starter: { min: 1, max: 3, cap: 5 },
};
export const GOAL_TAGS = ["Growth", "Income", "Inflation hedge", "Stability", "Diversification"] as const;

export type Transaction = {
  _id: string;
  symbol: string;
  type: TransactionType;
  date: Date | string;
  shares: number;
  pricePerShare: number;
  totalAmount: number;
  fees: number;
  netAmount: number;
  notes: string;
  ratio: string;
  warrantNo?: string | null;
  taxDeducted?: number;
  zakatDeducted?: number;
  financialYear?: string;
  dividendType?: string;
  deletedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type PriceSnapshot = {
  _id: string;
  symbol: string;
  price: number;
  timestamp: Date | string;
  source: string;
  isMarketHours: boolean;
};

export type DecisionLogEntry = {
  _id: string;
  symbol: string;
  date: Date | string;
  trigger: string;
  interpretation: string;
  action: string;
  positionBefore: number;
  positionAfter: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type TargetAllocationEntry = {
  _id: string;
  symbol: string;
  targetPercent: number;
  rebalanceBand: number;
  rationale: string;
};
