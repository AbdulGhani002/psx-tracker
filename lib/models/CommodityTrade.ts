import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const COMMODITY_SIDES = ["LONG", "SHORT"] as const;

// A PMEX commodity / index futures trade (swing). Entry/exit in PKR per unit
// (what the user actually trades). P/L, commission and CGT are derived.
const CommodityTradeSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true }, // GOLD, SILVER, CRUDE, KSE100...
    name: { type: String, default: "" },
    side: { type: String, required: true, enum: COMMODITY_SIDES, default: "LONG" },
    lots: { type: Number, required: true, default: 1, min: 0 },
    lotSize: { type: Number, required: true, default: 1, min: 0 }, // units per lot (oz, barrels, index pts)
    entryPrice: { type: Number, required: true, default: 0 },
    entryDate: { type: String, required: true }, // ISO
    exitPrice: { type: Number, default: null },
    exitDate: { type: String, default: null },
    currentPrice: { type: Number, default: null }, // manual mark for open trades
    status: { type: String, default: "OPEN", enum: ["OPEN", "CLOSED"] },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type CommodityTrade = InferSchemaType<typeof CommodityTradeSchema> & { _id: string };

export const CommodityTradeModel: Model<CommodityTrade> =
  (models.CommodityTrade as Model<CommodityTrade>) ||
  model<CommodityTrade>("CommodityTrade", CommodityTradeSchema);
