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
    // The slice of total investable wealth that never leaves the money-market
    // fund. Deployment plans subtract it before anything is spendable, so a
    // buying spree cannot quietly consume the buffer.
    // The CASH target: the share of the whole book (equities plus the fund)
    // that is meant to sit in the money-market fund rather than in shares.
    mfCashReservePct: { type: Number, default: 5 },
    // Your broker's commission on a trade, in percent of value; the per-share
    // floor of 3 paisa and the 15% sales tax on the commission are fixed.
    brokeragePct: { type: Number, default: 0.15 },
    // Only buy a name whose price is inside its buy band. Outside it, the money
    // stays in cash and waits, instead of being deployed at a reduced weight.
    strictBuyZones: { type: Boolean, default: false },
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
    // Automatic recording from PSX announcements (lib/corporate-actions).
    autoDividends: { type: Boolean, default: true },
    autoBonus: { type: Boolean, default: true },
    zakatOnDividends: { type: String, default: "none" }, // "none" (declaration on file) | "paidUp" (2.5% of face value, deducted from the dividend)
    bonusTaxWithheld: { type: Boolean, default: true }, // companies withhold 10% (filer) / 20% of bonus shares for tax
    bonusTaxFiler: { type: Number, default: 10 },
    bonusTaxNonFiler: { type: Number, default: 20 },
    // Company announcements for held names, sent as the exchange posts them (lib/announcements).
    announceTelegram: { type: Boolean, default: true }, // kept: an old on/off, read when no level is set
    announceEmail: { type: Boolean, default: true },
    // How much of the announcements board each channel carries:
    // off | board (board meetings only) | key (board, results, payouts, notices) | all
    announceTelegramLevel: { type: String, default: "key" },
    announceEmailLevel: { type: String, default: "all" },
    // What else Telegram carries.
    alertPrices: { type: Boolean, default: true }, // buy and sell zones, drift, flows, KMI, sell discipline
    alertExDates: { type: Boolean, default: true }, // ex-dividend and book-closure reminders
    alertBoardMeetings: { type: Boolean, default: true }, // a held name's board meeting, up to a week ahead
    alertWeeklyDigest: { type: Boolean, default: true }, // the Friday portfolio digest
    telegramQuant: { type: Boolean, default: true }, // the model's daily charts and next-day read
    announceEmailTo: { type: String, default: "" }, // blank: the verified account email
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
  mfCashReservePct: 5,
  brokeragePct: 0.15,
  strictBuyZones: false,
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
  autoDividends: true,
  autoBonus: true,
  zakatOnDividends: "none" as string,
  bonusTaxWithheld: true,
  bonusTaxFiler: 10,
  bonusTaxNonFiler: 20,
  announceTelegram: true,
  announceEmail: true,
  announceEmailTo: "",
  announceTelegramLevel: "key" as string,
  announceEmailLevel: "all" as string,
  alertPrices: true,
  alertExDates: true,
  alertBoardMeetings: true,
  alertWeeklyDigest: true,
  telegramQuant: true,
};
