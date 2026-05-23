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
