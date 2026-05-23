import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const PriceSnapshotSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    price: { type: Number, required: true },
    timestamp: { type: Date, required: true, default: () => new Date() },
    source: { type: String, required: true, default: "stub" },
    isMarketHours: { type: Boolean, default: false },
  },
  { timestamps: false }
);

PriceSnapshotSchema.index({ symbol: 1, timestamp: -1 });

export type PriceSnapshot = InferSchemaType<typeof PriceSnapshotSchema> & { _id: string };

export const PriceSnapshotModel: Model<PriceSnapshot> =
  (models.PriceSnapshot as Model<PriceSnapshot>) ||
  model<PriceSnapshot>("PriceSnapshot", PriceSnapshotSchema);
