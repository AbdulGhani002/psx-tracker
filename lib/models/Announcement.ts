import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// One row of the exchange's company-announcements board
// (dps.psx.com.pk/announcements/companies), kept once by its document
// number. Every row the scanner sees is stored; only the ones for names a
// user holds are delivered, and the delivery to each user is recorded on
// the row so a message goes out once.
const DeliverySchema = new Schema(
  {
    userId: { type: String, required: true },
    status: { type: String, default: "pending" }, // pending | sent | partial | failed | skipped
    telegram: { type: String, default: "" }, // sent | link | failed | off
    email: { type: String, default: "" }, // sent | link | failed | off
    attempts: { type: Number, default: 1 },
    lastAt: { type: Date, default: () => new Date() },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const AnnouncementSchema = new Schema(
  {
    annId: { type: String, required: true, unique: true }, // the portal's document number
    symbol: { type: String, required: true, index: true },
    company: { type: String, default: "" },
    title: { type: String, default: "" },
    kind: { type: String, default: "other" }, // board | results | payout | agm | material | other
    announcedAt: { type: Date, required: true, index: true }, // the board's date and time (PKT)
    dateOnly: { type: Boolean, default: false }, // read from the company's page: the day, no time
    pdfPath: { type: String, default: "" }, // /download/document/282940.pdf or /download/attachment/282829-1.pdf
    images: { type: [String], default: [] }, // /download/image/282940-1.gif
    fileBytes: { type: Number, default: 0 },
    seenAt: { type: Date, default: () => new Date() },
    deliveries: { type: [DeliverySchema], default: [] },
  },
  { timestamps: true }
);

AnnouncementSchema.index({ symbol: 1, announcedAt: -1 });
AnnouncementSchema.index({ "deliveries.userId": 1, announcedAt: -1 });

export type Announcement = InferSchemaType<typeof AnnouncementSchema> & { _id: string };

export const AnnouncementModel: Model<Announcement> =
  (models.Announcement as Model<Announcement>) || model<Announcement>("Announcement", AnnouncementSchema);
