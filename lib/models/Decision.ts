import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// The decision log — the spine of the sell-discipline system.
//
// APPEND-ONLY, enforced at the API layer: there is no update or delete route.
// Entries are never edited; corrections are NEW entries referencing the old via
// `correctsId`. The single sanctioned amendment is `outcomeReview`, a reserved
// slot that is WRITE-ONCE (set only while empty) — grading a past decision is
// not rewriting it.
//
// The state snapshot (price, weights, fair value, fired triggers, frozen
// thesis) is taken SERVER-SIDE at write time so future-you audits what
// past-you actually saw — not what either of you wishes had been true.
const OutcomeReviewSchema = new Schema(
  {
    reviewedAt: { type: String, required: true },
    whatHappened: { type: String, required: true },
    // Grades the REASONING at the time, not the outcome — a good decision can
    // have a bad outcome and vice versa. That separation is what makes the
    // scorecard improve behaviour instead of rewarding luck.
    decisionQuality: { type: Number, required: true, min: 1, max: 5 },
    lesson: { type: String, default: "" },
  },
  { _id: false }
);

const DecisionSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    timestamp: { type: String, required: true }, // ISO, set server-side
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    action: {
      type: String,
      required: true,
      enum: ["buy", "add", "trim", "sell_all", "hold_through_trigger", "rebuy", "park_cash"],
    },

    // State at the moment of action — snapshot.
    priceAtDecision: { type: Number, default: 0 },
    weightBeforePct: { type: Number, default: 0 },
    weightAfterPct: { type: Number, default: 0 },
    fairValueSnapshot: {
      type: new Schema(
        { low: { type: Number, default: 0 }, base: { type: Number, default: 0 }, high: { type: Number, default: 0 }, method: { type: String, default: "" } },
        { _id: false }
      ),
      default: () => ({}),
    },
    firedTriggers: { type: [String], default: [] },

    // The reasoning — what makes this a decision log, not a trade blotter.
    rationale: { type: String, required: true },
    thesisSnapshot: { type: String, default: "" }, // the thesis as it stood, frozen
    expectedOutcome: { type: String, default: "" },
    falsifier: { type: String, required: true }, // what would prove THIS decision wrong

    // Filled later; write-once.
    reviewDate: { type: String, default: "" },
    outcomeReview: { type: OutcomeReviewSchema, default: null },

    // Corrections chain — the append-only answer to "I logged it wrong".
    correctsId: { type: String, default: "" },
  },
  { timestamps: true, strict: true }
);

DecisionSchema.index({ userId: 1, symbol: 1, timestamp: -1 });
DecisionSchema.index({ userId: 1, timestamp: -1 });

export type Decision = InferSchemaType<typeof DecisionSchema> & { _id: string };

export const DecisionModel: Model<Decision> =
  (models.Decision as Model<Decision>) || model<Decision>("Decision", DecisionSchema);
