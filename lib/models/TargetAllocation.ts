import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const TargetAllocationSchema = new Schema(
  {
    symbol: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    targetPercent: { type: Number, required: true, min: 0, max: 100 },
    rebalanceBand: { type: Number, default: 3, min: 0, max: 50 },
    rationale: { type: String, default: "" },
  },
  { timestamps: true }
);

export type TargetAllocation = InferSchemaType<typeof TargetAllocationSchema> & { _id: string };

export const TargetAllocationModel: Model<TargetAllocation> =
  (models.TargetAllocation as Model<TargetAllocation>) ||
  model<TargetAllocation>("TargetAllocation", TargetAllocationSchema);
