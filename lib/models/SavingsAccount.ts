import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A profit-bearing bank savings account (e.g. Bank Alfalah Alfa) where profit
// accrues daily. We don't have a bank API, so the value is computed: an anchor
// balance on a date, the annual rate, and any deposits/withdrawals since — the
// app compounds daily so the displayed value grows without daily input.

const MovementSchema = new Schema(
  {
    date: { type: String, required: true }, // ISO yyyy-mm-dd
    type: { type: String, required: true, enum: ["DEPOSIT", "WITHDRAWAL"] },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
  },
  { _id: true }
);

const SavingsAccountSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    portfolioId: { type: String, default: "", index: true },
    name: { type: String, required: true, trim: true }, // e.g. "Bank Alfalah Alfa"
    bank: { type: String, default: "" },
    ratePercent: { type: Number, required: true, default: 0 }, // annual profit rate
    anchorDate: { type: String, required: true }, // ISO date of the known balance
    anchorBalance: { type: Number, required: true, default: 0 },
    movements: { type: [MovementSchema], default: [] },
    // Cash is a POSITION, not the absence of one: parked money carries a
    // purpose and a HARD review date. Past-due or purposeless cash is surfaced
    // with its inflation drag — a silent cost made visible.
    cashPlan: {
      type: new Schema(
        {
          purpose: { type: String, default: "" }, // strategic_wait|dry_powder|emergency|default_dump
          reviewBy: { type: String, default: "" }, // ISO date — hard expiry
          reviewReason: { type: String, default: "" }, // "await PTL FY26 report ~Oct 2026"
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type SavingsAccount = InferSchemaType<typeof SavingsAccountSchema> & { _id: string };

export const SavingsAccountModel: Model<SavingsAccount> =
  (models.SavingsAccount as Model<SavingsAccount>) ||
  model<SavingsAccount>("SavingsAccount", SavingsAccountSchema);
