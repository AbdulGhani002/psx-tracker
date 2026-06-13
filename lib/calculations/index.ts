export { xirr, cagr, type CashFlow } from "./xirr";
export {
  deriveFromTransactions,
  dividendsYTD,
  yieldOnCost,
  type HoldingDerived,
} from "./holding";
export {
  buildPositionRows,
  summarisePortfolio,
  type PositionRow,
  type PortfolioSummary,
} from "./portfolio";
export {
  project,
  SCENARIO_PRESETS,
  type ProjectionInputs,
  type ProjectionRow,
  type ProjectionResult,
  type ScenarioPreset,
} from "./projection";
export {
  computePSXFees,
  PSX_BROKERAGE_RATE,
  PSX_PER_SHARE_MIN,
  type FeeBreakdown,
} from "./fees";
export { computeCashBalance, type CashSummary } from "./cash";
export {
  computeRebalance,
  type RebalanceSuggestion,
  type RebalanceResult,
  type RebalanceInput,
} from "./rebalance";
export { valueSavings, valueFund, type SavingsValuation, type FundValuation } from "./assets";
export {
  buildTaxReport,
  dividendWhtFlags,
  type TaxReport,
  type TaxSettings,
  type DividendTaxRow,
} from "./tax";
export { computeRisk, maxDrawdown, type RiskMetrics } from "./risk";
export { valueTrade, type TradeValuation, type CommodityTradeInput } from "./pmex";
export {
  buildDividendProfiles,
  forecastDividends,
  type DividendForecast,
  type ForecastEvent,
  type ForecastMonth,
  type SymbolDividendProfile,
  type DividendPayment,
  type FiscalYearDividend,
  type FundamentalsInput,
  type ForecastOptions,
  type Cadence,
} from "./dividend-forecast";
