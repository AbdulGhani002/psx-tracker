import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Generic store for precomputed/scheduled datasets. A background cron writes the
// latest result here; the UI reads the stored snapshot instantly (no live
// compute on page load). One document per key.
const FeedSnapshotSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "kse100SectorWeights"
    data: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, default: "ok" }, // ok | error | building
    note: { type: String, default: "" },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export type FeedSnapshot = InferSchemaType<typeof FeedSnapshotSchema> & { _id: string };

export const FeedSnapshotModel: Model<FeedSnapshot> =
  (models.FeedSnapshot as Model<FeedSnapshot>) ||
  model<FeedSnapshot>("FeedSnapshot", FeedSnapshotSchema);
