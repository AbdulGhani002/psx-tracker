import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const MutualFundSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    portfolioId: { type: String, default: "", index: true },
    name: { type: String, required: true, trim: true }, // user-facing label
    mufapName: { type: String, required: true, trim: true }, // exact MUFAP name for NAV lookup
    amc: { type: String, default: "" },
    units: { type: Number, required: true, default: 0 }, // for daily-dividend funds: units as of anchorDate
    avgCost: { type: Number, default: 0 }, // avg NAV paid per unit
    // Daily-dividend / money-market funds keep NAV at par and grow your UNITS via
    // reinvested daily dividends. Model that like savings accrual.
    fundType: { type: String, default: "growth" }, // "growth" | "dailyDividend"
    // A money-market fund keeps earning on days MUFAP does not publish a NAV.
    // Flagging it lets the valuation carry the NAV forward over weekends and
    // holidays instead of showing a balance that appears to stop working every
    // Friday. Equity and bond funds must NOT be flagged: their NAV moves on
    // markets, and accruing a trend for them would be an invention.
    moneyMarket: { type: Boolean, default: false },
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
    // Units bought and redeemed through the trade form, newest last. The
    // position above is the running result; this is the record.
    trades: {
      type: [
        new Schema(
          {
            date: { type: Date, required: true },
            side: { type: String, required: true, enum: ["BUY", "REDEEM"] },
            units: { type: Number, required: true },
            nav: { type: Number, required: true },
            amount: { type: Number, required: true },
            notes: { type: String, default: "" },
          },
          { _id: true, timestamps: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export type MutualFund = InferSchemaType<typeof MutualFundSchema> & { _id: string };

export const MutualFundModel: Model<MutualFund> =
  (models.MutualFund as Model<MutualFund>) || model<MutualFund>("MutualFund", MutualFundSchema);
