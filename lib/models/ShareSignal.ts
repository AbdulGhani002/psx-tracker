import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// The strategy's read of each share on each close, kept for good: the model's
// score and rank, the price, the P/E against its usual, the dividend yield
// and the expected edge. Three months on, each one is checked against what
// the share did (lib/macro/live.ts), and those outcomes move the expected
// edges (lib/macro/learn.ts).
const ShareSignalSchema = new Schema(
  {
    date: { type: String, required: true },
    symbol: { type: String, required: true },
    sector: { type: String, default: "" },
    price: { type: Number, required: true },
    score: { type: Number, default: null },
    pctile: { type: Number, default: null },
    thin: { type: Boolean, default: false },
    pe: { type: Number, default: null },
    usualPe: { type: Number, default: null },
    dividendYieldPct: { type: Number, default: null },
    rate: { type: Number, default: null },
    edge: { type: Number, default: null },
    model: { type: String, default: "" },
  },
  { timestamps: false }
);
ShareSignalSchema.index({ symbol: 1, date: 1 }, { unique: true });
ShareSignalSchema.index({ date: 1 });

export type ShareSignal = InferSchemaType<typeof ShareSignalSchema> & { _id: string };

export const ShareSignalModel: Model<ShareSignal> = (models.ShareSignal as Model<ShareSignal>) || model<ShareSignal>("ShareSignal", ShareSignalSchema);
