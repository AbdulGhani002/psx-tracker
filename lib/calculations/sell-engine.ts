// The sell/trim discipline engine.
//
// The analyzer used to validate HOLDING — it was silent (or reassuring) about
// selling. Backwards: holding is the default that needs no courage; selling is
// the decision that needs discipline. This module makes the sell side
// first-class: pre-committed falsifiable triggers, class-aware rules, and
// behavioural guards that watch the INVESTOR, not just the stock.
//
// Everything here is pure and unit-tested. Nothing auto-trades: a fired
// trigger raises a card the user must clear by LOGGING A DECISION — including
// the explicit "hold_through_trigger" override. Silence is the one option the
// system refuses to offer.

import { afterTaxPct, type TaxSettings } from "./pk-tax";

export type AssetClass =
  | "compounder"
  | "stalwart"
  | "cyclical"
  | "asset_play"
  | "turnaround"
  | "value_trap"
  | ""; // unclassified — class-specific rules stay OFF until the user decides

export type TriggerType =
  | "price_target"
  | "thesis_broken"
  | "opportunity_cost"
  | "concentration"
  | "cyclical_peak"
  | "cash_conversion"
  | "time_stop"
  | "rebuy_review"
  | "cash_expiry";

export type FiredTrigger = {
  type: TriggerType;
  symbol: string;
  message: string; // plain language, ready for a card or a Telegram ping
  severity: "action" | "warn";
};

export type DecisionAction =
  | "buy"
  | "add"
  | "trim"
  | "sell_all"
  | "hold_through_trigger"
  | "rebuy"
  | "park_cash";

// What the evaluator needs to know about one position. Missing data = the
// corresponding rule silently doesn't apply (never guessed).
export type PositionSignal = {
  symbol: string;
  classification: AssetClass;
  price: number;
  avgCost: number;
  weightPct: number;
  maxWeightPct: number; // per-position cap; 0 → caller passes the global cap
  fairValueHigh: number | null; // MY ceiling — null when no plan set
  fairValueLow: number | null;
  fairValueBase: number | null;
  invalidatorsOccurred: string[]; // invalidators the user has marked as TRUE
  // opportunity cost
  earningsYieldPct: number | null;
  dividendYieldPct: number | null;
  // cyclical peak
  peTtm: number | null;
  sectorMedianPe: number | null;
  epsLatest: number | null;
  epsMax5y: number | null;
  rateDirection: "rising" | "falling" | "flat" | "unknown";
  // cash conversion (OCF is MANUAL — no free feed carries it)
  cumOcf3y: number | null;
  cumPat3y: number | null;
  // time stop
  monthsHeld: number | null;
  timeStopMonths: number; // 0 = off
};

export type EngineConfig = {
  settings: TaxSettings;
  netRiskFreePct: number | null; // the user's REAL alternative: MMF net yield (or T-bill net)
  cashConversionWeak: number; // default 0.70
  cyclicalEpsPeakRatio: number; // default 0.85 — "at/near a multi-year high"
};

export const DEFAULT_ENGINE_CONFIG = {
  cashConversionWeak: 0.7,
  cyclicalEpsPeakRatio: 0.85,
};

// After-tax forward return proxy for an equity position: dividend part at
// dividend WHT now, retained part at CGT on eventual sale — the same honest
// convention as the next-rupee ladder. This is what must clear the risk-free.
export function equityAfterTaxReturnPct(
  earningsYieldPct: number,
  dividendYieldPct: number,
  s: TaxSettings
): number {
  const dy = Math.max(0, dividendYieldPct);
  const retained = Math.max(0, earningsYieldPct - dy);
  return afterTaxPct(dy, "dividend", s) + afterTaxPct(retained, "capital-gain", s);
}

// Opportunity-cost spread vs the user's real cash alternative. Negative =
// the money is working harder in the money-market fund — the argument that
// beats "but it might go up".
export function opportunitySpreadPct(p: PositionSignal, cfg: EngineConfig): number | null {
  if (p.earningsYieldPct == null || cfg.netRiskFreePct == null) return null;
  const at = equityAfterTaxReturnPct(p.earningsYieldPct, p.dividendYieldPct ?? 0, cfg.settings);
  return at - cfg.netRiskFreePct;
}

// Cumulative OCF / cumulative PAT over ~3 years. Reported profit that never
// becomes cash is the classic PSX manufacturer trap (the PTL lesson).
export function cashConversion(
  cumOcf3y: number | null,
  cumPat3y: number | null
): { ratio: number; grade: "ok" | "weak" | "negative" } | null {
  if (cumOcf3y == null || cumPat3y == null || cumPat3y <= 0) return null;
  const ratio = cumOcf3y / cumPat3y;
  return { ratio, grade: ratio < 0 ? "negative" : ratio < DEFAULT_ENGINE_CONFIG.cashConversionWeak ? "weak" : "ok" };
}

// The counter-intuitive cyclical rule a naive tracker gets exactly wrong:
// a LOW P/E on PEAK earnings while the macro driver rolls over is a SELL
// signal — the market is telling you the E is about to fall.
export function cyclicalPeakFires(p: PositionSignal, cfg: EngineConfig): boolean {
  if (p.classification !== "cyclical") return false;
  if (p.peTtm == null || p.sectorMedianPe == null || p.epsLatest == null || p.epsMax5y == null) return false;
  if (!(p.peTtm > 0) || !(p.sectorMedianPe > 0) || !(p.epsMax5y > 0)) return false;
  const cheapOnScreen = p.peTtm < p.sectorMedianPe;
  const earningsAtPeak = p.epsLatest >= cfg.cyclicalEpsPeakRatio * p.epsMax5y;
  const macroRollingOver = p.rateDirection === "rising";
  return cheapOnScreen && earningsAtPeak && macroRollingOver;
}

export function evaluateTriggers(p: PositionSignal, cfg: EngineConfig): FiredTrigger[] {
  const fired: FiredTrigger[] = [];
  const f = (type: TriggerType, message: string, severity: "action" | "warn" = "action") =>
    fired.push({ type, symbol: p.symbol, message, severity });

  // 1. Price ceiling — MY number, not the market's.
  if (p.fairValueHigh != null && p.fairValueHigh > 0 && p.price >= p.fairValueHigh) {
    f(
      "price_target",
      `${p.symbol} at Rs ${p.price.toFixed(2)} has reached your ceiling (Rs ${p.fairValueHigh.toFixed(2)}). ` +
        `You pre-committed to selling here — would you BUY it at this price today?`
    );
  }

  // 2. Thesis broken — an invalidator the user marked true.
  for (const inv of p.invalidatorsOccurred) {
    f("thesis_broken", `${p.symbol}: your own invalidator is now TRUE — "${inv}". The thesis you bought is gone; what exactly are you holding?`);
  }

  // 3. Opportunity cost vs the real cash alternative.
  const spread = opportunitySpreadPct(p, cfg);
  if (spread != null && spread < 0) {
    f(
      "opportunity_cost",
      `${p.symbol}'s after-tax forward return trails your money-market alternative by ${Math.abs(spread).toFixed(1)}pp. ` +
        `Cash is beating this position without the risk.`
    );
  }

  // 4. Concentration — flagged no matter how much you love it.
  if (p.maxWeightPct > 0 && p.weightPct > p.maxWeightPct) {
    f(
      "concentration",
      `${p.symbol} is ${p.weightPct.toFixed(1)}% of the book — over your ${p.maxWeightPct.toFixed(0)}% cap. ` +
        `The trim quantity is the weight delta, not a feeling.`
    );
  }

  // 5. Cyclical peak.
  if (cyclicalPeakFires(p, cfg)) {
    f(
      "cyclical_peak",
      `${p.symbol} (cyclical): P/E ${p.peTtm!.toFixed(1)} is BELOW the sector median ${p.sectorMedianPe!.toFixed(1)} ` +
        `while EPS sits at/near a multi-year peak and rates are rising. For a cyclical this is the SELL setup, not a bargain — ` +
        `the market is pricing the earnings fall.`
    );
  }

  // 6. Cash conversion.
  const cc = cashConversion(p.cumOcf3y, p.cumPat3y);
  if (cc && cc.grade !== "ok") {
    f(
      "cash_conversion",
      cc.grade === "negative"
        ? `${p.symbol}: 3-year operating cash flow is NEGATIVE against positive reported profit (OCF/PAT ${cc.ratio.toFixed(2)}). Reported profit is not becoming cash.`
        : `${p.symbol}: only ${(cc.ratio * 100).toFixed(0)}% of 3-year reported profit converted to operating cash (<${DEFAULT_ENGINE_CONFIG.cashConversionWeak * 100}%). Earnings-quality flag.`,
      cc.grade === "negative" ? "action" : "warn"
    );
  }

  // 7. Time stop — held long with the thesis unproven.
  if (p.timeStopMonths > 0 && p.monthsHeld != null && p.monthsHeld >= p.timeStopMonths) {
    f(
      "time_stop",
      `${p.symbol}: held ${Math.floor(p.monthsHeld)} months, past your ${p.timeStopMonths}-month time stop with the thesis still unproven. ` +
        `Time is also a cost — the money has been unavailable for every other idea.`,
      "warn"
    );
  }

  return fired;
}

// --- Behavioural guards: they watch the investor, not the stock -------------
// None of these block anything. They make you look at the thing you're avoiding
// before the decision is logged.

// Anchoring-to-cost: cost basis is irrelevant to a forward decision.
export function detectCostAnchoring(rationale: string, avgCost: number): string | null {
  const text = rationale.toLowerCase();
  const phrases = /\b(break[\s-]?even|my (buy|purchase|entry) price|what i paid|my cost|recover (to|my)|back to my|wait (for|till|until) it (gets|comes|goes) back)\b/;
  let hit = phrases.test(text);
  if (!hit && avgCost > 0) {
    // A number within 3% of avg cost quoted in a sell rationale is almost
    // always the anchor talking.
    const nums = text.match(/\d+(?:\.\d+)?/g) ?? [];
    hit = nums.some((n) => {
      const v = Number(n);
      return v > 0 && Math.abs(v - avgCost) / avgCost < 0.03;
    });
  }
  return hit
    ? `You're anchoring to cost (avg Rs ${avgCost.toFixed(2)}). The question is whether you'd buy at TODAY's price — not whether you're above or below what you paid.`
    : null;
}

// Escalating commitment: targets raised repeatedly without a logged fundamental
// reason — the exact bias that inflates a thesis to avoid selling.
export function detectEscalation(raisedCount: number, decisionsExplainingRaise: number): string | null {
  if (raisedCount >= 2 && decisionsExplainingRaise < raisedCount - 1) {
    return `You've raised this target ${raisedCount} times with only ${decisionsExplainingRaise} logged fundamental reason${decisionsExplainingRaise === 1 ? "" : "s"}. Are you moving the goalposts to avoid selling?`;
  }
  return null;
}

// Thesis drift: quietly rewriting the thesis to fit the price.
export function detectThesisDrift(editCount: number, decisionCount: number): string | null {
  if (editCount >= 3 && editCount > decisionCount * 2) {
    return `This thesis has been edited ${editCount} times against ${decisionCount} logged decision${decisionCount === 1 ? "" : "s"}. A thesis rewritten without decisions is being fitted to the price.`;
  }
  return null;
}

// --- Cash as a position -----------------------------------------------------

export type CashPurpose = "strategic_wait" | "dry_powder" | "emergency" | "default_dump" | "";

export function cashFlags(
  c: { label: string; purpose: CashPurpose; reviewBy: string; netYieldPct: number | null },
  todayIso: string,
  cpiPct: number | null
): FiredTrigger[] {
  const out: FiredTrigger[] = [];
  const drag =
    cpiPct != null && c.netYieldPct != null ? cpiPct - c.netYieldPct : null;
  const dragTxt = drag != null && drag > 0 ? ` It's losing ~${drag.toFixed(1)}pp/yr of purchasing power while it waits.` : "";
  if (c.purpose === "default_dump" || c.purpose === "") {
    out.push({
      type: "cash_expiry",
      symbol: c.label,
      message: `${c.label}: this cash has NO plan (purpose not set). Parked money without a job is a silent cost.${dragTxt}`,
      severity: "warn",
    });
  }
  if (c.reviewBy && c.reviewBy <= todayIso) {
    out.push({
      type: "cash_expiry",
      symbol: c.label,
      message: `${c.label}: past its review date (${c.reviewBy}). Decide — deploy it, or set a new dated reason to keep waiting.${dragTxt}`,
      severity: "action",
    });
  }
  return out;
}

// --- Re-buy discipline ------------------------------------------------------

export function rebuyFlags(
  r: { symbol: string; maxPrice: number; reviewOn: string; requiredConditions: string[] },
  price: number | null,
  todayIso: string
): FiredTrigger[] {
  const out: FiredTrigger[] = [];
  if (r.reviewOn && r.reviewOn <= todayIso) {
    const aboveCeiling = price != null && r.maxPrice > 0 && price > r.maxPrice;
    out.push({
      type: "rebuy_review",
      symbol: r.symbol,
      message: aboveCeiling
        ? `${r.symbol} re-buy review due — check your ${r.requiredConditions.length} condition${r.requiredConditions.length === 1 ? "" : "s"}. ` +
          `But price Rs ${price!.toFixed(2)} is ABOVE your ceiling (Rs ${r.maxPrice.toFixed(2)}). Do not chase.`
        : `${r.symbol} re-buy review due — check your ${r.requiredConditions.length} condition${r.requiredConditions.length === 1 ? "" : "s"} against the new data before touching the buy button.`,
      severity: "action",
    });
  }
  return out;
}

// Suppression: a fired trigger stops nagging only when a decision addressed it,
// and even then only for a while — overriding is allowed, forgetting is not.
export const HOLD_SUPPRESSION_DAYS = 90;
export const SELL_SUPPRESSION_DAYS = 30;

export function triggerSuppressed(
  type: TriggerType,
  symbol: string,
  decisions: Array<{ symbol: string; action: DecisionAction; firedTriggers: string[]; timestamp: string }>,
  nowIso: string
): boolean {
  const now = new Date(nowIso).getTime();
  for (const d of decisions) {
    if (d.symbol !== symbol) continue;
    const age = (now - new Date(d.timestamp).getTime()) / 86400000;
    if (d.action === "hold_through_trigger" && d.firedTriggers.includes(type) && age <= HOLD_SUPPRESSION_DAYS) return true;
    if ((d.action === "trim" || d.action === "sell_all") && age <= SELL_SUPPRESSION_DAYS) return true;
  }
  return false;
}
