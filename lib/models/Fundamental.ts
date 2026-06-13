import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Cached company fundamentals (EPS / profit per fiscal year) scraped from PSX.
// One document per symbol, refreshed when stale. Used by the dividend forecast
// to ground projections in earnings.
const AnnualSchema = new Schema(
  {
    fiscalYear: { type: Number, required: true },
    eps: { type: Number, default: null },
    profitAfterTax: { type: Number, default: null },
  },
  { _id: false }
);

const PayoutSchema = new Schema(
  {
    date: { type: String, default: null }, // ISO; announcement date
    pctOfFace: { type: Number, required: true },
    cycle: { type: String, default: "" }, // F | i | ii | iii
    isCash: { type: Boolean, default: true },
  },
  { _id: false }
);

const FundamentalSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true, unique: true },
    faceValue: { type: Number, default: 10 },
    annual: { type: [AnnualSchema], default: [] },
    latestEps: { type: Number, default: null },
    epsGrowthPct: { type: Number, default: null },
    payouts: { type: [PayoutSchema], default: [] }, // authoritative PSX payout history
    source: { type: String, default: "psx-dps" },
    fetchedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export type Fundamental = InferSchemaType<typeof FundamentalSchema> & { _id: string };

export const FundamentalModel: Model<Fundamental> =
  (models.Fundamental as Model<Fundamental>) ||
  model<Fundamental>("Fundamental", FundamentalSchema);
