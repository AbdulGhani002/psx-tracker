import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Each share's valuation on each close (lib/valuation/run.ts): the price and
// the T-bill it was worked out on, each method's value, the fair value and its
// band, the zones, the expected return, the signal, and which triggers fired.
// Yesterday's row against today's is what the alerts read.
const ValuationRunSchema = new Schema(
  {
    userId: { type: String, required: true },
    symbol: { type: String, required: true },
    date: { type: String, required: true }, // the close, yyyy-mm-dd
    price: { type: Number, required: true },
    tbillPct: { type: Number, required: true },
    r: { type: Number, required: true },
    g: { type: Number, default: null },
    values: { type: Schema.Types.Mixed, default: null },
    fairValue: { type: Number, default: null },
    band: { type: [Number], default: null },
    zones: { type: Schema.Types.Mixed, default: null },
    expected: { type: Schema.Types.Mixed, default: null },
    excess: { type: Number, default: null },
    signal: { type: String, required: true },
    gates: { type: Schema.Types.Mixed, default: null },
    notes: { type: [String], default: [] },
    fired: { type: [String], default: [] }, // trigger ids
    version: { type: Number, required: true }, // the assumption's
  },
  { timestamps: true }
);
ValuationRunSchema.index({ userId: 1, symbol: 1, date: -1 }, { unique: true });
ValuationRunSchema.index({ userId: 1, date: -1 });

export type ValuationRun = InferSchemaType<typeof ValuationRunSchema> & { _id: string };

export const ValuationRunModel: Model<ValuationRun> = (models.ValuationRun as Model<ValuationRun>) || model<ValuationRun>("ValuationRun", ValuationRunSchema);
