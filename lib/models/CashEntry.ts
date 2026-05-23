import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const CASH_ENTRY_TYPES = ["DEPOSIT", "WITHDRAWAL"] as const;
export type CashEntryType = (typeof CASH_ENTRY_TYPES)[number];

const CashEntrySchema = new Schema(
  {
    date: { type: Date, required: true, default: () => new Date(), index: true },
    type: { type: String, required: true, enum: CASH_ENTRY_TYPES },
    amount: { type: Number, required: true, min: 0 }, // always positive; sign comes from type
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type CashEntry = InferSchemaType<typeof CashEntrySchema> & { _id: string };

export const CashEntryModel: Model<CashEntry> =
  (models.CashEntry as Model<CashEntry>) ||
  model<CashEntry>("CashEntry", CashEntrySchema);
