import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A share on the user's sell list with the prices they would sell at
// (lib/sell-list): take-profit levels above and stops below. A profit level
// is reached on the first day, from the day it was set, whose high gets to
// it; a stop on the first close at or under it. Telegram says so once, and
// the level arms again after a close 5% back the other way.
const LevelSchema = new Schema(
  {
    price: { type: Number, required: true },
    kind: { type: String, enum: ["profit", "stop"], default: "profit" },
    sellPct: { type: Number, default: null }, // of the shares held then, when set
    note: { type: String, default: "" },
    armedAt: { type: String, default: "" }, // yyyy-mm-dd: days from this one on count
    reachedAt: { type: String, default: "" },
    reachedPrice: { type: Number, default: null }, // the day's high (profit) or close (stop)
    reachedClose: { type: Number, default: null },
  },
  { _id: false }
);

const SellListSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    levels: { type: [LevelSchema], default: [] },
    note: { type: String, default: "" },
    checkedThrough: { type: String, default: "" }, // the last closing file applied
  },
  { timestamps: true }
);

SellListSchema.index({ userId: 1, symbol: 1 }, { unique: true });

export type SellList = InferSchemaType<typeof SellListSchema> & { _id: string };

export const SellListModel: Model<SellList> = (models.SellList as Model<SellList>) || model<SellList>("SellList", SellListSchema);
