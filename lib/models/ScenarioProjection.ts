import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const AssumptionsSchema = new Schema(
  {
    annualGrowthRate: { type: Number, required: true, default: 0.12 },
    endingPE: { type: Number, required: true, default: 10 },
    payoutRatio: { type: Number, required: true, default: 0.4 },
    horizonYears: { type: Number, required: true, default: 10 },
    useDRIP: { type: Boolean, default: true },
    customNotes: { type: String, default: "" },
  },
  { _id: false }
);

const ScenarioProjectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    symbol: { type: String, default: null, uppercase: true, trim: true },
    assumptions: { type: AssumptionsSchema, required: true },
  },
  { timestamps: true }
);

export type ScenarioProjection = InferSchemaType<typeof ScenarioProjectionSchema> & { _id: string };

export const ScenarioProjectionModel: Model<ScenarioProjection> =
  (models.ScenarioProjection as Model<ScenarioProjection>) ||
  model<ScenarioProjection>("ScenarioProjection", ScenarioProjectionSchema);
