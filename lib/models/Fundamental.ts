import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Cached company fundamentals (EPS / profit per fiscal year) scraped from PSX.
// One document per symbol, refreshed when stale. Used by the dividend forecast
// to ground projections in earnings.
const AnnualSchema = new Schema(
  {
    fiscalYear: { type: Number, required: true },
    eps: { type: Number, default: null },
    profitAfterTax: { type: Number, default: null },
    netMarginPct: { type: Number, default: null },
    revenue: { type: Number, default: null },
  },
  { _id: false }
);

const PayoutSchema = new Schema(
  {
    date: { type: String, default: null }, // ISO; announcement date
    bookClosure: { type: String, default: null }, // ISO; book-closure (entitlement) date
    pctOfFace: { type: Number, required: true },
    cycle: { type: String, default: "" }, // F | i | ii | iii
    payoutType: { type: String, default: "cash" }, // cash | bonus | right | other
  },
  { _id: false }
);

const FundamentalSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true, unique: true },
    faceValue: { type: Number, default: 10 },
    sector: { type: String, default: "" }, // PSX sector name (for market sector weights)
    annual: { type: [AnnualSchema], default: [] },
    latestEps: { type: Number, default: null },
    epsGrowthPct: { type: Number, default: null },
    // Richer fundamentals for sector-aware valuation + display.
    latestNetMarginPct: { type: Number, default: null },
    marginTrendPct: { type: Number, default: null },
    revenueGrowthPct: { type: Number, default: null },
    peTtm: { type: Number, default: null },
    pegTtm: { type: Number, default: null },
    sharesOutstanding: { type: Number, default: null },
    marketCapThousands: { type: Number, default: null },
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
