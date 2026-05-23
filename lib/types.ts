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
  createdAt: Date | string;
  updatedAt: Date | string;
};

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
