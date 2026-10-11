import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// The sectors ticked on the watchlist page, one document per user. The
// strategy page researches every share in them; selling is only ever about
// what is held. `symbols` is the single-share list of 11.15.0, emptied on the
// first save since.
const WatchlistSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    sectors: { type: [String], default: [] },
    symbols: { type: [String], default: [] },
  },
  { timestamps: true }
);

export type Watchlist = InferSchemaType<typeof WatchlistSchema> & { _id: string };

export const WatchlistModel: Model<Watchlist> = (models.Watchlist as Model<Watchlist>) || model<Watchlist>("Watchlist", WatchlistSchema);
