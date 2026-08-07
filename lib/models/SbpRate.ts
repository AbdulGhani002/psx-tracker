import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A single SBP policy-rate step. The rate is effective from `effectiveDate`
// until the next entry's date. Annualised percent (e.g. 11 for 11%).
//
// This is a PER-USER override curve. It used to be global and unscoped, which
// meant one account could delete or rewrite the policy rate for everybody —
// corrupting every user's savings accrual, required return and valuations.
const SbpRateSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    effectiveDate: { type: String, required: true }, // ISO yyyy-mm-dd
    rate: { type: Number, required: true, min: 0, max: 100 },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

// Uniqueness is per user, not global: a bare unique index on effectiveDate let
// the first user to claim a date block every other user from using it.
SbpRateSchema.index({ userId: 1, effectiveDate: 1 }, { unique: true });

export type SbpRate = InferSchemaType<typeof SbpRateSchema> & { _id: string };

export const SbpRateModel: Model<SbpRate> =
  (models.SbpRate as Model<SbpRate>) || model<SbpRate>("SbpRate", SbpRateSchema);
