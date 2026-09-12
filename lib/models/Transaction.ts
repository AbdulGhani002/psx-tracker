import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/types";

export { TRANSACTION_TYPES, type TransactionType };

const TransactionSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    // Which of the user's portfolios this belongs to; "" is the default one.
    portfolioId: { type: String, default: "", index: true },
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
    warrantNo: { type: String }, // unset for non-dividend txs; partial unique index below
    taxDeducted: { type: Number, default: 0 },
    zakatDeducted: { type: Number, default: 0 },
    financialYear: { type: String, default: "" },
    dividendType: { type: String, default: "" },
    // Soft-delete marker. null (or absent on legacy docs) = active. A Date means
    // the row is in the Trash and must be excluded from every calculation.
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TransactionSchema.index({ symbol: 1, date: 1 });
TransactionSchema.index({ deletedAt: 1 });
// Partial unique index: only enforces uniqueness on docs that have a real
// string warrantNo. Sparse alone wouldn't work because Mongoose's `default:
// null` was storing explicit nulls — and null collides with null.
TransactionSchema.index({ userId: 1, symbol: 1, date: 1 });
// Serves getAllTransactions(): find({userId, deletedAt:null}).sort({date:-1, createdAt:-1}).
// Without a compound index in exactly this shape Mongo has to fetch every one of
// the user's transactions and sort them in memory on the app's hottest read.
TransactionSchema.index({ userId: 1, deletedAt: 1, date: -1, createdAt: -1 });
TransactionSchema.index(
  { userId: 1, warrantNo: 1 },
  { unique: true, partialFilterExpression: { warrantNo: { $type: "string" } } }
);

export type Transaction = InferSchemaType<typeof TransactionSchema> & { _id: string };

export const TransactionModel: Model<Transaction> =
  (models.Transaction as Model<Transaction>) ||
  model<Transaction>("Transaction", TransactionSchema);
