import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A T-bill or a sukuk held (lib/fixed-income/value.ts values it): what was
// paid, the face value it repays, its dates and, for a sukuk, its profit rate
// and how often it pays. A market price can be entered for a sukuk; without
// one it is carried at cost pulled to face over its life.
const FixedIncomeSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    portfolioId: { type: String, default: "", index: true },
    kind: { type: String, enum: ["tbill", "sukuk"], required: true },
    name: { type: String, required: true, trim: true }, // "12M T-bill", "GoP Ijara Sukuk 5Y"
    face: { type: Number, required: true, min: 0 },
    cost: { type: Number, required: true, min: 0 },
    purchaseDate: { type: String, required: true }, // yyyy-mm-dd
    maturityDate: { type: String, required: true }, // yyyy-mm-dd
    couponPct: { type: Number, default: 0 }, // a year, on face
    couponsPerYear: { type: Number, default: 0 },
    taxPct: { type: Number, default: 15 },
    pricePct: { type: Number, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type FixedIncome = InferSchemaType<typeof FixedIncomeSchema> & { _id: string };

export const FixedIncomeModel: Model<FixedIncome> =
  (models.FixedIncome as Model<FixedIncome>) || model<FixedIncome>("FixedIncome", FixedIncomeSchema);
