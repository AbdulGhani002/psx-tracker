import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Every cash dividend, bonus issue and split a share has had, as the
// exchange's closing file shows it: the day's last-day closing price under
// the close before (lib/quant/events.ts reads which it was). Seeded from the
// archive's record, then added to by the evening job each day.
const ShareEventSchema = new Schema(
  {
    symbol: { type: String, required: true },
    date: { type: String, required: true }, // the ex-date
    kind: { type: String, enum: ["cash", "bonus", "split", "other"], required: true },
    cash: { type: Number, default: 0 }, // rupees a share
    yieldPct: { type: Number, default: 0 }, // the cash over the close before
    ratioPct: { type: Number, default: 0 }, // a bonus or split's size
    source: { type: String, enum: ["archive", "sheet"], default: "sheet" },
  },
  { timestamps: false }
);
ShareEventSchema.index({ symbol: 1, date: 1 }, { unique: true });

export type ShareEvent = InferSchemaType<typeof ShareEventSchema> & { _id: string };

export const ShareEventModel: Model<ShareEvent> = (models.ShareEvent as Model<ShareEvent>) || model<ShareEvent>("ShareEvent", ShareEventSchema);
