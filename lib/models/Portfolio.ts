import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// One account can keep several portfolios (a broker account, a family
// member's, a long-term book and a trading book). Transactions, cash entries,
// funds and savings accounts carry a portfolioId; rows with none belong to the
// default portfolio, which is how everything recorded before portfolios
// existed keeps its place. Holdings (targets, thesis, the cached position)
// stay one per symbol per user: they describe the whole book.
const PortfolioSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    broker: { type: String, default: "" },
    kind: { type: String, default: "mixed" }, // equity | funds | mixed
    color: { type: String, default: "" }, // a hex colour for the switcher and the cards
    isDefault: { type: Boolean, default: false },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

PortfolioSchema.index({ userId: 1, name: 1 }, { unique: true });

export type Portfolio = InferSchemaType<typeof PortfolioSchema> & { _id: string };

export const PortfolioModel: Model<Portfolio> = (models.Portfolio as Model<Portfolio>) || model<Portfolio>("Portfolio", PortfolioSchema);
