import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A single SBP policy-rate step. The rate is effective from `effectiveDate`
// until the next entry's date. Annualised percent (e.g. 11 for 11%).
const SbpRateSchema = new Schema(
  {
    effectiveDate: { type: String, required: true, unique: true }, // ISO yyyy-mm-dd
    rate: { type: Number, required: true, min: 0, max: 100 },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

export type SbpRate = InferSchemaType<typeof SbpRateSchema> & { _id: string };

export const SbpRateModel: Model<SbpRate> =
  (models.SbpRate as Model<SbpRate>) || model<SbpRate>("SbpRate", SbpRateSchema);
