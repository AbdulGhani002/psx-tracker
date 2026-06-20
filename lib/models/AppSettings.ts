import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// Singleton app configuration (one document, key = "global").
const AppSettingsSchema = new Schema(
  {
    userId: { type: String, default: "", index: true, unique: true },
    key: { type: String, default: "global" },
    filerStatus: { type: String, default: "filer" }, // "filer" | "non-filer"
    dividendWhtFiler: { type: Number, default: 15 }, // % WHT on dividends, filer
    dividendWhtNonFiler: { type: Number, default: 30 }, // %, non-filer
    cgtRateFiler: { type: Number, default: 15 }, // % CGT on listed securities, filer
    cgtRateNonFiler: { type: Number, default: 20 }, // %, non-filer
    pmexCommissionPerLot: { type: Number, default: 200 }, // Rs per lot, round-turn
    pmexCgtPercent: { type: Number, default: 15 }, // % CGT on commodity futures gains
    concentrationCap: { type: Number, default: 25 }, // % single-stock cap
    inflationPct: { type: Number, default: 0 }, // annual CPI inflation, for real (inflation-adjusted) returns
    // Valuation assumptions (editable)
    equityRiskPremiumPct: { type: Number, default: 6 }, // added to the SBP rate for required return
    defaultFairPE: { type: Number, default: 8 }, // assumed fair P/E for earnings-based fair value
    targetMonthlyIncome: { type: Number, default: 0 }, // for the income planner / passive-income coverage
    // Telegram alerts
    telegramBotToken: { type: String, default: "" },
    telegramChatId: { type: String, default: "" },
    alertsEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export type AppSettings = InferSchemaType<typeof AppSettingsSchema> & { _id: string };

export const AppSettingsModel: Model<AppSettings> =
  (models.AppSettings as Model<AppSettings>) ||
  model<AppSettings>("AppSettings", AppSettingsSchema);

export const DEFAULT_SETTINGS = {
  filerStatus: "filer" as string,
  dividendWhtFiler: 15,
  dividendWhtNonFiler: 30,
  cgtRateFiler: 15,
  cgtRateNonFiler: 20,
  pmexCommissionPerLot: 200,
  pmexCgtPercent: 15,
  concentrationCap: 25,
  inflationPct: 0,
  equityRiskPremiumPct: 6,
  defaultFairPE: 8,
  targetMonthlyIncome: 0,
  telegramBotToken: "",
  telegramChatId: "",
  alertsEnabled: false,
};
