import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A share's valuation inputs, one version per change (lib/valuation/engine.ts
// turns them into a fair value and zones). The judgements (normalised
// earnings, ROE, growth, multiples, discounts, governance) are the owner's: a
// version from the home machine's draft job arrives as a draft, and only an
// approved version is valued. Approving one supersedes the version before;
// the history stays.
const PartSchema = new Schema(
  {
    label: { type: String, default: "" },
    kind: { type: String, enum: ["listed", "unlisted", "operating", "cash"], default: "unlisted" },
    symbol: { type: String, default: "" },
    shares: { type: Number, default: null },
    value: { type: Number, default: null },
    haircut: { type: Number, default: 0 },
  },
  { _id: false }
);

const ValuationAssumptionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    version: { type: Number, required: true },
    status: { type: String, enum: ["draft", "approved", "superseded", "rejected"], default: "draft" },
    source: { type: String, enum: ["you", "auto"], default: "you" },
    asOf: { type: String, required: true }, // the filing period the inputs reflect, yyyy-mm-dd
    type: { type: String, enum: ["bank", "insurer", "operating", "opco-investments", "holdco", "shell"], default: "operating" },
    policy: { type: String, enum: ["quality", "standard", "holdco", "shell"], default: "standard" },
    governance: { type: String, enum: ["green", "amber", "red"], default: "green" },
    confirm: { type: String, default: "" },
    eps: { type: Number, default: null },
    dps: { type: Number, default: null },
    bvps: { type: Number, default: null },
    roe: { type: Number, default: null },
    g: { type: Number, default: null },
    valueGrowth: { type: Number, default: null },
    pe: { type: Number, default: null },
    peSpread: { type: Number, default: null },
    premium: { type: Number, default: null },
    sotp: {
      type: new Schema(
        { parts: { type: [PartSchema], default: [] }, netDebt: { type: Number, default: 0 }, discount: { type: Number, default: 0 }, shares: { type: Number, default: null } },
        { _id: false }
      ),
      default: null,
    },
    weights: { type: Schema.Types.Mixed, default: null },
    margins: { type: Schema.Types.Mixed, default: null },
    illiquid: { type: Boolean, default: false },
    metrics: { type: Schema.Types.Mixed, default: null },
    note: { type: String, default: "" },
    // What the draft job read: the filings and figures behind each number.
    evidence: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);
ValuationAssumptionSchema.index({ userId: 1, symbol: 1, version: -1 }, { unique: true });
ValuationAssumptionSchema.index({ userId: 1, status: 1 });

export type ValuationAssumption = InferSchemaType<typeof ValuationAssumptionSchema> & { _id: string };

export const ValuationAssumptionModel: Model<ValuationAssumption> =
  (models.ValuationAssumption as Model<ValuationAssumption>) || model<ValuationAssumption>("ValuationAssumption", ValuationAssumptionSchema);
