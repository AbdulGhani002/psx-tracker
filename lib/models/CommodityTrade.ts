import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const COMMODITY_SIDES = ["LONG", "SHORT"] as const;

// PMEX offers exactly two settlement styles (their investor guide, "Contracts/
// Products"): a DELIVERABLE contract settles by giving or taking the actual
// commodity after expiry, a CASH_SETTLED one just books the cash difference.
// Either can be squared off any time before expiry.
export const COMMODITY_CONTRACT_TYPES = ["CASH_SETTLED", "DELIVERABLE"] as const;

// A PMEX commodity / index futures trade (swing). Entry/exit in PKR per unit
// (what the user actually trades). P/L, commission and CGT are derived.
const CommodityTradeSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
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
    // --- futures mechanics -------------------------------------------------
    // A futures contract expires. PMEX's own guide is explicit that a position
    // still open at expiry goes to final settlement — and on a DELIVERABLE
    // contract that means actually giving or taking the commodity. Tracking the
    // expiry is the difference between a position and a surprise.
    expiryDate: { type: String, default: null }, // ISO; null = not recorded
    contractType: { type: String, default: "CASH_SETTLED", enum: COMMODITY_CONTRACT_TYPES },
    // What you actually posted to hold the position. Futures returns measured
    // against notional understate the result badly; against margin is the real
    // number, and it is also what a margin call is measured against.
    marginPosted: { type: Number, default: 0, min: 0 },
    // Set when this contract replaces one you rolled out of, so a position
    // carried across contract months reads as one idea rather than N trades.
    rolledFromId: { type: String, default: null },
  },
  { timestamps: true }
);

export type CommodityTrade = InferSchemaType<typeof CommodityTradeSchema> & { _id: string };

export const CommodityTradeModel: Model<CommodityTrade> =
  (models.CommodityTrade as Model<CommodityTrade>) ||
  model<CommodityTrade>("CommodityTrade", CommodityTradeSchema);
