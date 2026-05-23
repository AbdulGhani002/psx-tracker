import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const WatchlistEntrySchema = new Schema(
  {
    symbol: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, default: "" },
    sector: { type: String, default: "" },
    notes: { type: String, default: "" },
    targetBuyPrice: { type: Number, default: null }, // alert me when price drops to this
    targetSellPrice: { type: Number, default: null }, // alert me when price rises to this
  },
  { timestamps: true }
);

export type WatchlistEntry = InferSchemaType<typeof WatchlistEntrySchema> & { _id: string };

export const WatchlistEntryModel: Model<WatchlistEntry> =
  (models.WatchlistEntry as Model<WatchlistEntry>) ||
  model<WatchlistEntry>("WatchlistEntry", WatchlistEntrySchema);
