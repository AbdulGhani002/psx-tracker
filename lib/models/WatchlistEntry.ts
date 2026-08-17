import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const WatchlistEntrySchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    name: { type: String, default: "" },
    sector: { type: String, default: "" },
    notes: { type: String, default: "" },
    // Legacy single-point targets. Kept so existing rows keep working: when a
    // zone bound is absent, the point target below stands in for it.
    targetBuyPrice: { type: Number, default: null },
    targetSellPrice: { type: Number, default: null },
    // Price BANDS decided in advance, away from the screen. buyZoneHigh is the
    // "buy at or under" level; sellZoneLow is the "sell at or above" level. The
    // opposite bound of each band is optional and open-ended when null.
    buyZoneLow: { type: Number, default: null },
    buyZoneHigh: { type: Number, default: null },
    sellZoneLow: { type: Number, default: null },
    sellZoneHigh: { type: Number, default: null },
    // Position floor: never suggest selling unless MORE than this many shares
    // are held. Stops the app nagging about trades too small to be worth the
    // brokerage. Zero means no floor.
    minSellShares: { type: Number, default: 0 },
    // Set false to keep the row for reference without any Telegram pings.
    alertsOn: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type WatchlistEntry = InferSchemaType<typeof WatchlistEntrySchema> & { _id: string };

export const WatchlistEntryModel: Model<WatchlistEntry> =
  (models.WatchlistEntry as Model<WatchlistEntry>) ||
  model<WatchlistEntry>("WatchlistEntry", WatchlistEntrySchema);
