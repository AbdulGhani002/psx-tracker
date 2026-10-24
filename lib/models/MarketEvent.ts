import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Dated events that move the market or a plan: SBP's MPC meetings, CPI
// releases, results deadlines, futures expiries, PSX holidays, index reviews,
// the IMF, the FOMC. Kept here, not in the code: seeded from published
// calendars and changed on the Strategy page. The evening brief names the
// next ones.
const MarketEventSchema = new Schema(
  {
    date: { type: String, required: true, index: true }, // yyyy-mm-dd, Pakistan time
    title: { type: String, required: true, trim: true },
    kind: { type: String, default: "other" }, // mpc | cpi | results | expiry | holiday | index | imf | budget | world | other
    about: { type: Boolean, default: false }, // an estimate: "about", a moon date
    source: { type: String, default: "" },
  },
  { timestamps: true }
);
MarketEventSchema.index({ date: 1, title: 1 }, { unique: true });

export type MarketEvent = InferSchemaType<typeof MarketEventSchema> & { _id: string };

export const MarketEventModel: Model<MarketEvent> = (models.MarketEvent as Model<MarketEvent>) || model<MarketEvent>("MarketEvent", MarketEventSchema);
