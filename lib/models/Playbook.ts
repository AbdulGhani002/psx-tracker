import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// The written plan: one document per user holding the money that is not yet in
// the market, the regime judgements that are yours to make rather than the
// app's to fetch, and the weekly report's switch.

// Money that is not in the market yet. Three kinds, because they are not
// interchangeable: cash you could spend this morning, money owed to you that
// has not landed, and money you expect but do not have a claim on yet.
const CashSourceSchema = new Schema(
  {
    label: { type: String, required: true },
    kind: { type: String, default: "available" }, // available | receivable | expected
    amount: { type: Number, default: 0 }, // in `currency`
    currency: { type: String, default: "PKR" }, // PKR | USD
    fxRate: { type: Number, default: 0 }, // PKR per unit; 0 = use the live rate
    expectedDate: { type: String, default: "" }, // ISO date for receivable/expected
    note: { type: String, default: "" },
    settledAt: { type: String, default: "" }, // ISO date once it has landed
  },
  { _id: true }
);

// The half of the regime scorecard a machine cannot read: foreign flows,
// politics, breadth. Stored with the date they were judged so a stale opinion
// is visible as stale rather than passing for current.
const RegimeManualSchema = new Schema(
  {
    key: { type: String, required: true }, // foreign | politics | breadth
    score: { type: Number, default: 0 }, // -2..+2
    note: { type: String, default: "" },
    setAt: { type: String, default: "" }, // ISO date
  },
  { _id: false }
);

const PlaybookSchema = new Schema(
  {
    userId: { type: String, default: "", index: true, unique: true },

    // --- cash not yet in the market ------------------------------------------
    cashSources: { type: [CashSourceSchema], default: [] },

    // --- regime --------------------------------------------------------------
    regimeManual: { type: [RegimeManualSchema], default: [] },
    // A monthly note in your own words. The scorecard gives the number; this is
    // where the reasoning lives, and it is what makes the record teachable.
    regimeJournal: {
      type: [
        new Schema(
          {
            month: { type: String, default: "" }, // YYYY-MM
            band: { type: String, default: "" },
            rawScore: { type: Number, default: 0 },
            note: { type: String, default: "" },
            didWhat: { type: String, default: "" },
            shouldHave: { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    // --- weekly report --------------------------------------------------------
    weeklyReportEnabled: { type: Boolean, default: false },
    weeklyReportEmail: { type: String, default: "" },
  },
  { timestamps: true }
);

export type Playbook = InferSchemaType<typeof PlaybookSchema> & { _id: string };

export const PlaybookModel: Model<Playbook> =
  (models.Playbook as Model<Playbook>) || model<Playbook>("Playbook", PlaybookSchema);

export const CASH_KINDS = ["available", "receivable", "expected"] as const;
export type CashKind = (typeof CASH_KINDS)[number];
