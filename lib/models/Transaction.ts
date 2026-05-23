import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/types";

export { TRANSACTION_TYPES, type TransactionType };

const TransactionSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    type: { type: String, required: true, enum: TRANSACTION_TYPES },
    date: { type: Date, required: true, index: true },
    shares: { type: Number, required: true, default: 0 },
    pricePerShare: { type: Number, required: true, default: 0 },
    totalAmount: { type: Number, required: true, default: 0 },
    fees: { type: Number, default: 0 },
    netAmount: { type: Number, required: true, default: 0 },
    notes: { type: String, default: "" },
    ratio: { type: String, default: "" },
  },
  { timestamps: true }
);

TransactionSchema.index({ symbol: 1, date: 1 });

export type Transaction = InferSchemaType<typeof TransactionSchema> & { _id: string };

export const TransactionModel: Model<Transaction> =
  (models.Transaction as Model<Transaction>) ||
  model<Transaction>("Transaction", TransactionSchema);
