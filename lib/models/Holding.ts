import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const HoldingSchema = new Schema(
  {
    symbol: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    sector: { type: String, required: true, trim: true },
    shariaCompliant: { type: Boolean, default: false },
    currentShares: { type: Number, default: 0 },
    avgCostBasis: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    realizedPL: { type: Number, default: 0 },
    totalDividendsReceived: { type: Number, default: 0 },
    targetAllocationPercent: { type: Number, default: 0, min: 0, max: 100 },
    rebalanceBand: { type: Number, default: 3, min: 0, max: 50 },
    targetRationale: { type: String, default: "" },
    notes: { type: String, default: "" },

    // Playbook / sizing fields (from the user's PSX investing framework).
    tier: { type: String, default: "" }, // Anchor | Core | Satellite | Starter
    convictionScore: { type: Number, default: 0, min: 0, max: 25 }, // 5-factor scorecard /25
    goalTag: { type: String, default: "" }, // Growth | Income | Inflation hedge | Stability | Diversification
    thesis: { type: String, default: "" }, // 2-sentence thesis
    trackedMetrics: {
      // the "4 numbers" tracked each quarter
      type: [
        new Schema(
          {
            name: { type: String, default: "" },
            source: { type: String, default: "" },
            green: { type: String, default: "" },
            red: { type: String, default: "" },
            current: { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Manual dividend-forecast overrides (0 / "" = auto).
    dividendOverride: {
      type: new Schema(
        {
          parValue: { type: Number, default: 0 },
          cadence: { type: String, default: "" },
          payoutRatioPct: { type: Number, default: 0 },
          expectedAnnualDps: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // Saved per-stock compounding-model assumptions (overrides generic defaults).
    modelAssumptions: {
      type: new Schema(
        {
          mode: { type: String, default: "eps" }, // "eps" | "nav" (holding companies)
          annualGrowth: { type: Number, default: 0.1 },
          peStart: { type: Number, default: 8 },
          peEnd: { type: Number, default: 8 },
          payoutRatio: { type: Number, default: 0.4 },
          navDiscount: { type: Number, default: 0 }, // discount-to-NAV for NAV mode (0..1)
          horizonYears: { type: Number, default: 20 },
          useDRIP: { type: Boolean, default: true },
          saved: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { timestamps: true }
);

export type Holding = InferSchemaType<typeof HoldingSchema> & { _id: string };

export const HoldingModel: Model<Holding> =
  (models.Holding as Model<Holding>) || model<Holding>("Holding", HoldingSchema);
