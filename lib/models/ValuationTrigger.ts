import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A sell (or buy) rule written in advance, as data: a figure, a comparison, a
// threshold and what to do (lib/valuation/engine.ts, firedTriggers). Price
// figures are tested on every close; a filing's figures when its assumption
// is approved.
const ValuationTriggerSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    metric: { type: String, required: true }, // price | pe | pb | yield | excess | discount | a filing figure
    op: { type: String, enum: [">=", "<=", ">", "<"], required: true },
    threshold: { type: Number, required: true },
    action: { type: String, enum: ["trim", "exit", "buy", "review"], required: true },
    note: { type: String, default: "" },
    active: { type: Boolean, default: true },
    lastFiredAt: { type: String, default: "" }, // the close it last fired on
  },
  { timestamps: true }
);

export type ValuationTrigger = InferSchemaType<typeof ValuationTriggerSchema> & { _id: string };

export const ValuationTriggerModel: Model<ValuationTrigger> =
  (models.ValuationTrigger as Model<ValuationTrigger>) || model<ValuationTrigger>("ValuationTrigger", ValuationTriggerSchema);
