import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Each close's levels for an index as they were published (lib/index-week),
// and what followed once the sessions have passed: the live record, kept as
// it happened.
const IndexForecastSchema = new Schema(
  {
    code: { type: String, required: true }, // KSE100, KMI30, KSE30
    sessions: { type: Number, required: true }, // 5 or 20
    asOf: { type: String, required: true }, // the close they were set on
    close: { type: Number, required: true },
    sigmaPct: { type: Number, default: null },
    range: { type: [Number], default: [] },
    mid: { type: Number, default: null },
    buy: { type: [Number], default: [] },
    sell: { type: [Number], default: [] },
    outcome: { type: Schema.Types.Mixed, default: null }, // { date, close, low, high }
    hits: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

IndexForecastSchema.index({ code: 1, sessions: 1, asOf: 1 }, { unique: true });

export type IndexForecast = InferSchemaType<typeof IndexForecastSchema> & { _id: string };

export const IndexForecastModel: Model<IndexForecast> =
  (models.IndexForecast as Model<IndexForecast>) || model<IndexForecast>("IndexForecast", IndexForecastSchema);
