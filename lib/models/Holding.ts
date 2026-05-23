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
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type Holding = InferSchemaType<typeof HoldingSchema> & { _id: string };

export const HoldingModel: Model<Holding> =
  (models.Holding as Model<Holding>) || model<Holding>("Holding", HoldingSchema);
