import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const MutualFundSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // user-facing label
    mufapName: { type: String, required: true, trim: true }, // exact MUFAP name for NAV lookup
    amc: { type: String, default: "" },
    units: { type: Number, required: true, default: 0 },
    avgCost: { type: Number, default: 0 }, // avg NAV paid per unit
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type MutualFund = InferSchemaType<typeof MutualFundSchema> & { _id: string };

export const MutualFundModel: Model<MutualFund> =
  (models.MutualFund as Model<MutualFund>) || model<MutualFund>("MutualFund", MutualFundSchema);
