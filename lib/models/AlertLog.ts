import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Dedup key prevents re-sending the same alert. e.g. "watch-hit:SYS:buy:2026-06-05"
// Scoped per user so two people who both hold the same symbol don't share a
// dedupe slot (which would silently swallow one of their alerts).
const AlertLogSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    dedupeKey: { type: String, required: true },
    kind: { type: String, default: "" },
    message: { type: String, default: "" },
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// A given alert fires at most once per day per user.
AlertLogSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });

export type AlertLog = InferSchemaType<typeof AlertLogSchema> & { _id: string };

export const AlertLogModel: Model<AlertLog> =
  (models.AlertLog as Model<AlertLog>) || model<AlertLog>("AlertLog", AlertLogSchema);
