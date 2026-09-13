import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A zakat payment the user made, kept so the Zakat page can show what was
// paid against what the estimate says is due.
const ZakatPaymentSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    portfolioId: { type: String, default: "", index: true },
    date: { type: Date, required: true, default: () => new Date(), index: true },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type ZakatPayment = InferSchemaType<typeof ZakatPaymentSchema> & { _id: string };

export const ZakatPaymentModel: Model<ZakatPayment> = (models.ZakatPayment as Model<ZakatPayment>) || model<ZakatPayment>("ZakatPayment", ZakatPaymentSchema);
