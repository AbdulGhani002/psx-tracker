import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// The month's interest rates as the user entered them (the strategy page
// prefills them from SBP and PBS): one a month per user. The strategy
// (lib/strategy/plan.ts) reads the latest and the one before it, for the
// direction rates are moving in.
const RateSnapshotSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    month: { type: String, required: true }, // yyyy-mm
    policyPct: { type: Number, default: null },
    tbill3mPct: { type: Number, default: null },
    tbill6mPct: { type: Number, default: null },
    tbill12mPct: { type: Number, default: null },
    sukukPct: { type: Number, default: null }, // GoP Ijara sukuk
    savingsPct: { type: Number, default: null }, // the best savings account on offer to you
    moneyMarketPct: { type: Number, default: null }, // a money market fund's yield
    inflationPct: { type: Number, default: null }, // CPI, a year
    taxPct: { type: Number, default: 15 }, // withheld on profit
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

RateSnapshotSchema.index({ userId: 1, month: 1 }, { unique: true });

export type RateSnapshot = InferSchemaType<typeof RateSnapshotSchema> & { _id: string };

export const RateSnapshotModel: Model<RateSnapshot> =
  (models.RateSnapshot as Model<RateSnapshot>) || model<RateSnapshot>("RateSnapshot", RateSnapshotSchema);
