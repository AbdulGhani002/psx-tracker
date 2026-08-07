import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const MutualFundSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    name: { type: String, required: true, trim: true }, // user-facing label
    mufapName: { type: String, required: true, trim: true }, // exact MUFAP name for NAV lookup
    amc: { type: String, default: "" },
    units: { type: Number, required: true, default: 0 }, // for daily-dividend funds: units as of anchorDate
    avgCost: { type: Number, default: 0 }, // avg NAV paid per unit
    // Daily-dividend / money-market funds keep NAV at par and grow your UNITS via
    // reinvested daily dividends. Model that like savings accrual.
    fundType: { type: String, default: "growth" }, // "growth" | "dailyDividend"
    annualYieldPct: { type: Number, default: 0 }, // the fund's annualised payout (for unit accrual)
    anchorDate: { type: String, default: "" }, // ISO date the `units` figure is accurate
    // Cash is a POSITION, not the absence of one: parked money carries a
    // purpose and a HARD review date. Past-due or purposeless cash is surfaced
    // with its inflation drag — a silent cost made visible.
    cashPlan: {
      type: new Schema(
        {
          purpose: { type: String, default: "" }, // strategic_wait|dry_powder|emergency|default_dump
          reviewBy: { type: String, default: "" }, // ISO date — hard expiry
          reviewReason: { type: String, default: "" }, // "await PTL FY26 report ~Oct 2026"
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type MutualFund = InferSchemaType<typeof MutualFundSchema> & { _id: string };

export const MutualFundModel: Model<MutualFund> =
  (models.MutualFund as Model<MutualFund>) || model<MutualFund>("MutualFund", MutualFundSchema);
