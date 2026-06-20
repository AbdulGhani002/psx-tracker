import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const DecisionLogSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    date: { type: Date, required: true, default: () => new Date() },
    trigger: { type: String, required: true },
    interpretation: { type: String, required: true },
    action: { type: String, required: true },
    positionBefore: { type: Number, default: 0 },
    positionAfter: { type: Number, default: 0 },
  },
  { timestamps: true }
);

DecisionLogSchema.index({ date: -1 });

export type DecisionLog = InferSchemaType<typeof DecisionLogSchema> & { _id: string };

export const DecisionLogModel: Model<DecisionLog> =
  (models.DecisionLog as Model<DecisionLog>) ||
  model<DecisionLog>("DecisionLog", DecisionLogSchema);
