import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A share on the user's buy list with the prices they would buy at, in tiers
// from the highest down (lib/buy-list). A tier is reached on the first close
// after it was set whose day's low got to its top price; Telegram says so
// once, and the tier arms again after a close 5% above its top.
const TierSchema = new Schema(
  {
    high: { type: Number, required: true }, // the top of the zone
    low: { type: Number, default: null }, // its floor, where one is set
    note: { type: String, default: "" },
    armedAt: { type: String, default: "" }, // yyyy-mm-dd: closes from this day on count
    reachedAt: { type: String, default: "" }, // the day its low got there, since armed
    reachedLow: { type: Number, default: null },
    reachedClose: { type: Number, default: null },
  },
  { _id: false }
);

const BuyListSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    tiers: { type: [TierSchema], default: [] },
    note: { type: String, default: "" },
    checkedThrough: { type: String, default: "" }, // the last closing file applied
  },
  { timestamps: true }
);

BuyListSchema.index({ userId: 1, symbol: 1 }, { unique: true });

export type BuyList = InferSchemaType<typeof BuyListSchema> & { _id: string };

export const BuyListModel: Model<BuyList> = (models.BuyList as Model<BuyList>) || model<BuyList>("BuyList", BuyListSchema);
