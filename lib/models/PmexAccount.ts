import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const PMEX_MOVEMENT_KINDS = [
  "OPENING",
  "DEPOSIT",
  "WITHDRAWAL",
  "REALISED_PL",
  "UNREALISED_PL",
  "COMMISSION",
  "FEES",
  "CGT",
  "CGT_FEE",
  "BANK_CHARGES",
  "PROFIT_DISTRIBUTION",
] as const;

// The PMEX account as a whole, kept separately from the contracts inside it.
//
// PMEX's back office reports profit per SESSION and never per position — no
// entry, no exit, no lot count. That is enough to state exactly what the
// account holds and what trading it cost, and not enough to describe a single
// contract, so CommodityTrade stays empty rather than being filled with a
// guessed lot size that would silently corrupt every derived figure.
//
// Amounts are signed from the CLIENT's side: positive increased the account.
// PMEX's own ledger is written from the broker's side, where the balance runs
// negative because the money is owed to you.
const PmexAccountSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    accountNo: { type: String, required: true, trim: true },
    // The balance the statement itself prints, and the day it applies to. Not
    // derived here: it is the figure to reconcile the movements AGAINST.
    balance: { type: Number, required: true },
    balanceAsOf: { type: String, required: true }, // ISO
    openingBalance: { type: Number, required: true },
    openingAsOf: { type: String, required: true }, // ISO
    movements: {
      type: [
        new Schema(
          {
            date: { type: String, required: true }, // ISO
            kind: { type: String, required: true, enum: PMEX_MOVEMENT_KINDS },
            amount: { type: Number, required: true },
            description: { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: () => [],
    },
    // Per-session profit as PMEX reports it, kept so the trading record is
    // visible even though no contract can be reconstructed from it.
    sessions: {
      type: [
        new Schema(
          {
            date: { type: String, required: true },
            contract: { type: String, default: "" },
            realised: { type: Number, default: 0 },
            unrealised: { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: () => [],
    },
    statementFrom: { type: String, default: "" }, // ISO
    statementTo: { type: String, default: "" }, // ISO
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type PmexAccount = InferSchemaType<typeof PmexAccountSchema> & { _id: string };

export const PmexAccountModel: Model<PmexAccount> =
  (models.PmexAccount as Model<PmexAccount>) || model<PmexAccount>("PmexAccount", PmexAccountSchema);
