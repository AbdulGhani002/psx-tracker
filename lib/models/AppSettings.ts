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
    // Profit on debt (Section 151): bank/savings profit, T-bills, income funds'
    // debt profit. Withheld at source; final tax for most individuals. Defaults
    // per the FBR withholding schedule (ATL 15%, non-ATL 35%) — editable because
    // Finance Acts move these.
    podWhtFiler: { type: Number, default: 15 },
    podWhtNonFiler: { type: Number, default: 35 },
    pmexCommissionPerLot: { type: Number, default: 200 }, // Rs per lot, round-turn
    pmexCgtPercent: { type: Number, default: 15 }, // % CGT on commodity futures gains
    concentrationCap: { type: Number, default: 25 }, // % single-stock cap
    inflationPct: { type: Number, default: 0 }, // annual CPI inflation, for real (inflation-adjusted) returns
    // Valuation assumptions (editable)
    // Pakistan equity risk premium, in points over the SBP policy rate. This is
    // now MULTIPLIED BY THE SHARE'S OWN BETA (see calculations/capm.ts), so it is
    // the premium for a beta-1 stock, not a flat adder for everything.
    // 5.5 is what local practice implies and it reconciles with audited models:
    // AHCL's Level-3 fair value (A.F. Ferguson) uses r=16%, and 11.5% + 5.5% = 17%
    // for a market-risk share — while AHL's measured beta lands its hurdle on 16.0%.
    // A flat 10 put required return at 21.5%, which marked nearly everything expensive.
    equityRiskPremiumPct: { type: Number, default: 5.5 },
    defaultFairPE: { type: Number, default: 8 }, // assumed fair P/E for earnings-based fair value
    targetMonthlyIncome: { type: Number, default: 0 }, // for the income planner / passive-income coverage
    // Plan for BROKERAGE cash (the cash ledger balance) — same discipline as
    // fund/savings cash: a purpose and a review date, or it gets flagged.
    brokerCashPurpose: { type: String, default: "" },
    brokerCashReviewBy: { type: String, default: "" },
    brokerCashReviewReason: { type: String, default: "" },
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
  podWhtFiler: 15,
  podWhtNonFiler: 35,
  pmexCommissionPerLot: 200,
  pmexCgtPercent: 15,
  concentrationCap: 25,
  inflationPct: 0,
  equityRiskPremiumPct: 5.5,
  defaultFairPE: 8,
  targetMonthlyIncome: 0,
  brokerCashPurpose: "",
  brokerCashReviewBy: "",
  brokerCashReviewReason: "",
  telegramBotToken: "",
  telegramChatId: "",
  alertsEnabled: false,
};
