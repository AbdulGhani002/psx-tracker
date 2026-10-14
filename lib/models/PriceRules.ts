import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { DEFAULT_STEPS } from "@/lib/rules/ladder";

// The user's price rules (lib/rules): steps away from each held share's
// average price and what to do at each, the limits past which the economy
// has changed a lot, the shares the rules leave alone, and which steps have
// been told (until the price comes back to the average).
const StepSchema = new Schema(
  {
    move: { type: Number, required: true }, // % from the average price, signed
    action: { type: String, enum: ["hold", "add", "sell"], required: true },
    sizePct: { type: Number, default: 0 }, // of the shares held then
  },
  { _id: false }
);

const FiredSchema = new Schema(
  {
    symbol: { type: String, required: true },
    move: { type: Number, required: true },
    at: { type: String, required: true }, // yyyy-mm-dd
    close: { type: Number, required: true },
    anchor: { type: Number, required: true }, // the average price then
    told: { type: Boolean, default: true }, // false when marked without a message
  },
  { _id: false }
);

const PriceRulesSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    on: { type: Boolean, default: true },
    steps: { type: [StepSchema], default: () => DEFAULT_STEPS },
    ratePts: { type: Number, default: 2 }, // policy rate move, points, that counts as a lot
    rupeePct: { type: Number, default: 10 }, // rupee move against the dollar, %, that counts as a lot
    off: { type: [String], default: [] }, // shares the rules leave alone
    fired: { type: [FiredSchema], default: [] },
    quiet: { type: Boolean, default: true }, // the next run marks what is reached without telling it
    started: { type: Boolean, default: false }, // the first run's summary has gone
    checkedThrough: { type: String, default: "" }, // the last closing file applied
  },
  { timestamps: true }
);

export type PriceRules = InferSchemaType<typeof PriceRulesSchema> & { _id: string };

export const PriceRulesModel: Model<PriceRules> = (models.PriceRules as Model<PriceRules>) || model<PriceRules>("PriceRules", PriceRulesSchema);
