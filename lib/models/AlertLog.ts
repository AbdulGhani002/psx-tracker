import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Dedup key prevents re-sending the same alert. e.g. "watch-hit:SYS:buy:2026-06-05"
const AlertLogSchema = new Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    kind: { type: String, default: "" },
    message: { type: String, default: "" },
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export type AlertLog = InferSchemaType<typeof AlertLogSchema> & { _id: string };

export const AlertLogModel: Model<AlertLog> =
  (models.AlertLog as Model<AlertLog>) || model<AlertLog>("AlertLog", AlertLogSchema);
