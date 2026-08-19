import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const HoldingSchema = new Schema(
  {
    userId: { type: String, default: "", index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    sector: { type: String, required: true, trim: true },
    shariaCompliant: { type: Boolean, default: false },
    currentShares: { type: Number, default: 0 },
    avgCostBasis: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    realizedPL: { type: Number, default: 0 },
    totalDividendsReceived: { type: Number, default: 0 },
    targetAllocationPercent: { type: Number, default: 0, min: 0, max: 100 },
    rebalanceBand: { type: Number, default: 3, min: 0, max: 50 },
    targetRationale: { type: String, default: "" },
    // This position is holding a place for another symbol in the same sector,
    // bought because the one you actually want is above its buy band. The pair
    // shares ONE target weight and reverses when the primary comes into range.
    // See lib/calculations/standin.ts.
    standsInFor: { type: String, default: "", uppercase: true, trim: true },
    notes: { type: String, default: "" },

    // Playbook / sizing fields (from the user's PSX investing framework).
    tier: { type: String, default: "" }, // Anchor | Core | Satellite | Starter
    convictionScore: { type: Number, default: 0, min: 0, max: 25 }, // 5-factor scorecard /25
    goalTag: { type: String, default: "" }, // Growth | Income | Inflation hedge | Stability | Diversification
    thesis: { type: String, default: "" }, // 2-sentence thesis
    trackedMetrics: {
      // the "4 numbers" tracked each quarter
      type: [
        new Schema(
          {
            name: { type: String, default: "" },
            source: { type: String, default: "" },
            green: { type: String, default: "" },
            red: { type: String, default: "" },
            current: { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Manual dividend-forecast overrides (0 / "" = auto).
    dividendOverride: {
      type: new Schema(
        {
          parValue: { type: Number, default: 0 },
          cadence: { type: String, default: "" },
          payoutRatioPct: { type: Number, default: 0 },
          expectedAnnualDps: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // The sell-discipline plan: MY fair-value band, falsifiable invalidators,
    // class-specific rules and caps. Selling is the decision that needs
    // discipline — this is where it's pre-committed, before emotion.
    plan: {
      type: new Schema(
        {
          classification: { type: String, default: "" }, // compounder|stalwart|cyclical|asset_play|turnaround|value_trap
          fvLow: { type: Number, default: 0 },
          fvBase: { type: Number, default: 0 },
          fvHigh: { type: Number, default: 0 }, // the pre-committed price ceiling
          fvMethod: { type: String, default: "" },
          fvUpdatedAt: { type: String, default: "" },
          // Behavioural-guard counters: raises without logged reasons = goalpost-moving.
          fvHighRaisedCount: { type: Number, default: 0 },
          targetRaisedCount: { type: Number, default: 0 },
          thesisEditCount: { type: Number, default: 0 },
          // Falsifiable invalidators; marking one occurred fires thesis_broken.
          invalidators: {
            type: [new Schema({ text: { type: String, default: "" }, occurredAt: { type: String, default: "" } }, { _id: false })],
            default: [],
          },
          maxWeightPct: { type: Number, default: 0 }, // 0 = use the global concentration cap
          timeStopMonths: { type: Number, default: 0 }, // 0 = off
          // Cash-conversion inputs: PAT comes from the scraped financials, but NO
          // free feed carries operating cash flow — the user transcribes the 3-year
          // OCF sum from the annual report. Empty = "needs your input", never faked.
          cumOcf3y: { type: Number, default: null },
          openedAt: { type: String, default: "" },
          lastReviewedAt: { type: String, default: "" },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // Set on exit; the symbol (with zero shares) becomes the re-buy watchlist.
    rebuyRule: {
      type: new Schema(
        {
          active: { type: Boolean, default: false },
          maxPrice: { type: Number, default: 0 }, // "do not chase" ceiling
          requiredConditions: { type: [String], default: [] },
          reviewOn: { type: String, default: "" }, // when the deciding data lands
          setAt: { type: String, default: "" },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // The company's OWN disclosed valuation model, transcribed by hand from its
    // audited accounts (e.g. AHCL's Level-3 fair value: r=16%, g=5% on a Rs 1.35
    // dividend, signed off by A.F. Ferguson). When a company and its auditor have
    // published the assumptions behind a fair value, that outranks anything we
    // model ourselves — so we record it, cite the source, and show it.
    // Leave empty if the company discloses none. NEVER fill this with a guess:
    // an absent disclosed model is honest, an invented one is a fabricated number
    // wearing an auditor's name.
    disclosedValuation: {
      type: new Schema(
        {
          requiredReturnPct: { type: Number, default: 0 }, // the r the company used
          growthPct: { type: Number, default: 0 }, // the g the company used
          baseDps: { type: Number, default: 0 }, // the dividend it was built on
          source: { type: String, default: "" }, // report + auditor, for citation
          asOf: { type: String, default: "" }, // ISO date of the report
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    // Sum-of-the-parts / look-through config (holding companies).
    lookThrough: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          constituents: {
            type: [new Schema({ label: { type: String, default: "" }, symbol: { type: String, default: "" }, shares: { type: Number, default: 0 }, ownershipPct: { type: Number, default: 0 } }, { _id: false })],
            default: [],
          },
          // Named private/unlisted holdings (no PSX price) — e.g. PIA, Sachal
          // Energy for AHCL; CPHGC, Thar Energy for HUBCO. Each carries a value
          // (from the annual report / your estimate), not a fake live price.
          unlistedHoldings: {
            type: [new Schema({ label: { type: String, default: "" }, valuePkr: { type: Number, default: 0 }, ownershipPct: { type: Number, default: 0 }, note: { type: String, default: "" } }, { _id: false })],
            default: [],
          },
          unlistedValuePkr: { type: Number, default: 0 }, // legacy single lump (still summed)
          netDebtPkr: { type: Number, default: 0 },
          sharesOutstanding: { type: Number, default: 0 }, // 0 = derive from profit/EPS
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    bookValuePerShare: { type: Number, default: 0 }, // optional, enables P/B + ROE
    // Shariah purification: % of this company's dividend that comes from
    // non-permissible income (from Meezan/AlMeezan's annual report) — used to
    // compute the charity amount to give away.
    purificationPctOfDividend: { type: Number, default: 0 },
    // Saved per-stock compounding-model assumptions (overrides generic defaults).
    modelAssumptions: {
      type: new Schema(
        {
          mode: { type: String, default: "eps" }, // "eps" | "nav" (holding companies)
          annualGrowth: { type: Number, default: 0.1 },
          peStart: { type: Number, default: 8 },
          peEnd: { type: Number, default: 8 },
          payoutRatio: { type: Number, default: 0.4 },
          navDiscount: { type: Number, default: 0 }, // discount-to-NAV for NAV mode (0..1)
          horizonYears: { type: Number, default: 20 },
          useDRIP: { type: Boolean, default: true },
          saved: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { timestamps: true }
);

export type Holding = InferSchemaType<typeof HoldingSchema> & { _id: string };

export const HoldingModel: Model<Holding> =
  (models.Holding as Model<Holding>) || model<Holding>("Holding", HoldingSchema);
