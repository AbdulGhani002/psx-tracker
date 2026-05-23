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
