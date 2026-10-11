import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// The shares and sectors ticked on the watchlist page, one document per user.
// The strategy page reads them for what to buy; selling is only ever about
// what is held.
const WatchlistSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    symbols: { type: [String], default: [] },
    sectors: { type: [String], default: [] },
  },
  { timestamps: true }
);

export type Watchlist = InferSchemaType<typeof WatchlistSchema> & { _id: string };

export const WatchlistModel: Model<Watchlist> = (models.Watchlist as Model<Watchlist>) || model<Watchlist>("Watchlist", WatchlistSchema);
