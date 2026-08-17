import "server-only";
import { cache } from "react";
import {
  getAppSettings, getPortfolioSummary, getAllHoldings, getAllTransactions,
  getMutualFundsValued, getSavingsValued, getNetWorth, getCurrentPrices,
  getFundamentals, getSbpRateSteps, getTbill12mPct, getEffectiveInflationPct,
  getBetaMap,
} from "./data";
import { policyRateOn } from "./timeseries/sbp-rate";
import { afterTaxPct, whtPct, type TaxSettings } from "./calculations/pk-tax";
import {
  evaluateTriggers, triggerSuppressed, detectEscalation, detectThesisDrift,
  cashFlags, rebuyFlags, opportunitySpreadPct, cashConversion,
  type PositionSignal, type EngineConfig, type FiredTrigger, type AssetClass,
} from "./calculations/sell-engine";
import { DecisionModel, type Decision } from "./models/Decision";
import { connectDb } from "./db";
import { uid } from "./auth/uid";

// --- shared context ----------------------------------------------------------

// The user's REAL cash alternative, net of its own tax: their best money-market
// fund's live MUFAP yield after dividend WHT; else the 12M T-bill after
// profit-on-debt WHT; else null (rules that need it stay silent).
async function _getNetRiskFreePct(): Promise<{ pct: number | null; label: string }> {
  const s = (await getAppSettings()) as unknown as TaxSettings;
  const funds = await getMutualFundsValued().catch(() => []);
  const best = funds
    .map((f) => f.liveAnnualYieldPct ?? f.annualYieldPct)
    .filter((y): y is number => y != null && y > 0)
    .sort((a, b) => b - a)[0];
  if (best != null) return { pct: afterTaxPct(best, "dividend", s), label: "your money-market fund, net of WHT" };
  const tb = await getTbill12mPct().catch(() => null);
  if (tb != null) return { pct: afterTaxPct(tb, "profit-on-debt", s), label: "12M T-bill, net of WHT" };
  return { pct: null, label: "unavailable" };
}
export const getNetRiskFreePct = cache(_getNetRiskFreePct);

// Policy-rate direction over the last ~90 days — the macro leg of the
// cyclical-peak rule. Real curve only; unknown when history is thin.
async function _getRateDirection(): Promise<"rising" | "falling" | "flat" | "unknown"> {
  try {
    const { steps } = await getSbpRateSteps();
    const today = new Date().toISOString().slice(0, 10);
    const ago = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const now = policyRateOn(today, steps);
    const then = policyRateOn(ago, steps);
    if (!Number.isFinite(now) || !Number.isFinite(then)) return "unknown";
    if (now > then + 0.01) return "rising";
    if (now < then - 0.01) return "falling";
    return "flat";
  } catch {
    return "unknown";
  }
}
export const getRateDirection = cache(_getRateDirection);

// Sector median trailing P/E from the live 495-stock analytics universe — the
// comparator the cyclical rule needs, computed rather than hand-seeded.
async function _getSectorMedianPe(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const { getRatings } = await import("./analytics");
    const r = await getRatings(500);
    const bySector = new Map<string, number[]>();
    for (const s of r?.results ?? []) {
      if (s.pe != null && s.pe > 0 && s.sector) {
        const arr = bySector.get(s.sector) ?? [];
        arr.push(s.pe);
        bySector.set(s.sector, arr);
      }
    }
    for (const [sector, pes] of bySector) {
      pes.sort((a, b) => a - b);
      const mid = Math.floor(pes.length / 2);
      out.set(sector, pes.length % 2 ? pes[mid] : (pes[mid - 1] + pes[mid]) / 2);
    }
  } catch {
    /* analytics down → empty map → cyclical rule stays silent */
  }
  return out;
}
export const getSectorMedianPe = cache(_getSectorMedianPe);

export type PositionDiscipline = {
  signal: PositionSignal;
  fired: FiredTrigger[]; // after suppression
  firedRaw: FiredTrigger[]; // before suppression (for the position page)
  spreadPct: number | null;
  cashConv: { ratio: number; grade: "ok" | "weak" | "negative" } | null;
  cumPat3y: number | null;
  guardWarnings: string[]; // escalation + thesis drift (anchoring runs at decision time)
  plan: Record<string, unknown>;
};

async function _getSellDiscipline(): Promise<{
  positions: PositionDiscipline[];
  netRiskFree: { pct: number | null; label: string };
  rateDirection: "rising" | "falling" | "flat" | "unknown";
  config: EngineConfig;
}> {
  const [settings, summary, holdings, txs, netRiskFree, rateDirection, sectorPe, decisions] = await Promise.all([
    getAppSettings() as unknown as Promise<TaxSettings & { concentrationCap?: number }>,
    getPortfolioSummary(),
    getAllHoldings(),
    getAllTransactions(),
    getNetRiskFreePct(),
    getRateDirection(),
    getSectorMedianPe(),
    getRecentDecisions(400),
  ]);
  const cfg: EngineConfig = {
    settings,
    netRiskFreePct: netRiskFree.pct,
    cashConversionWeak: 0.7,
    cyclicalEpsPeakRatio: 0.85,
  };

  const held = summary.positions.filter((p) => p.shares > 0);
  const holdingBySym = new Map(holdings.map((h: any) => [h.symbol, h]));
  const syms = held.map((p) => p.symbol);
  const fundamentals = syms.length ? await getFundamentals(syms).catch(() => ({} as Record<string, any>)) : {};
  let ratingsBySym = new Map<string, any>();
  try {
    const { getRatings } = await import("./analytics");
    const r = await getRatings(500);
    ratingsBySym = new Map((r?.results ?? []).map((x) => [x.symbol.toUpperCase(), x]));
  } catch {
    /* EY/DY/pe unavailable → those rules stay silent */
  }
  const nowIso = new Date().toISOString();

  const positions: PositionDiscipline[] = held.map((p) => {
    const h: any = holdingBySym.get(p.symbol) ?? {};
    const plan: any = h.plan ?? {};
    const rating = ratingsBySym.get(p.symbol.toUpperCase());
    const f: any = (fundamentals as any)[p.symbol];
    const annual: Array<{ fiscalYear: number; eps: number | null; profitAfterTax: number | null }> = [...(f?.annual ?? [])].sort(
      (a, b) => b.fiscalYear - a.fiscalYear
    );
    const epsVals = annual.slice(0, 5).map((a) => a.eps).filter((e): e is number => e != null);
    const patVals = annual.slice(0, 3).map((a) => a.profitAfterTax).filter((v): v is number => v != null);
    const cumPat3y = patVals.length >= 2 ? patVals.reduce((s, v) => s + v, 0) : null;

    // Months held: the plan's openedAt when set, else the first recorded buy.
    let openedAt: string = plan.openedAt || "";
    if (!openedAt) {
      const first = txs.filter((t) => t.symbol === p.symbol).sort((a, b) => +new Date(a.date) - +new Date(b.date))[0];
      openedAt = first ? new Date(first.date).toISOString().slice(0, 10) : "";
    }
    const monthsHeld = openedAt ? (Date.now() - new Date(openedAt).getTime()) / (30.44 * 86400000) : null;

    const signal: PositionSignal = {
      symbol: p.symbol,
      classification: (plan.classification ?? "") as AssetClass,
      price: p.currentPrice,
      avgCost: p.avgCost,
      weightPct: p.currentPercent,
      maxWeightPct: plan.maxWeightPct > 0 ? plan.maxWeightPct : settings.concentrationCap ?? 25,
      fairValueHigh: plan.fvHigh > 0 ? plan.fvHigh : null,
      fairValueLow: plan.fvLow > 0 ? plan.fvLow : null,
      fairValueBase: plan.fvBase > 0 ? plan.fvBase : null,
      invalidatorsOccurred: (plan.invalidators ?? []).filter((i: any) => i.occurredAt).map((i: any) => i.text),
      earningsYieldPct: rating?.earnings_yield_pct ?? null,
      dividendYieldPct: rating?.dividend_yield_pct ?? null,
      peTtm: rating?.pe ?? null,
      sectorMedianPe: rating?.sector ? sectorPe.get(rating.sector) ?? null : null,
      epsLatest: epsVals[0] ?? null,
      epsMax5y: epsVals.length ? Math.max(...epsVals) : null,
      rateDirection,
      cumOcf3y: plan.cumOcf3y ?? null,
      cumPat3y,
      monthsHeld,
      timeStopMonths: plan.timeStopMonths ?? 0,
    };

    const firedRaw = evaluateTriggers(signal, cfg);
    const fired = firedRaw.filter((t) => !triggerSuppressed(t.type, p.symbol, decisions as any, nowIso));

    const decisionsForSymbol = decisions.filter((d) => d.symbol === p.symbol).length;
    const guardWarnings: string[] = [];
    // Proxy for "raises explained": each raise should have SOME logged decision
    // behind it. Crude on purpose — the guard nudges, the human judges.
    const esc =
      detectEscalation((plan.fvHighRaisedCount ?? 0) + (plan.targetRaisedCount ?? 0), decisionsForSymbol) ??
      null;
    if (esc) guardWarnings.push(esc);
    const drift = detectThesisDrift(plan.thesisEditCount ?? 0, decisionsForSymbol);
    if (drift) guardWarnings.push(drift);

    return {
      signal,
      fired,
      firedRaw,
      spreadPct: opportunitySpreadPct(signal, cfg),
      cashConv: cashConversion(signal.cumOcf3y, signal.cumPat3y),
      cumPat3y,
      guardWarnings,
      plan,
    };
  });

  return { positions, netRiskFree, rateDirection, config: cfg };
}
export const getSellDiscipline = cache(_getSellDiscipline);

// --- the inbox ---------------------------------------------------------------

export type InboxCard = FiredTrigger & { kind: "trigger" | "cash" | "rebuy" };

async function _getDecisionInbox(): Promise<{
  cards: InboxCard[];
  guardWarnings: Array<{ symbol: string; message: string }>;
  reviewsDue: Decision[];
  netRiskFree: { pct: number | null; label: string };
  inflationPct: number | null;
}> {
  const [{ positions, netRiskFree }, settings, funds, savings, netWorth, holdings, inf] = await Promise.all([
    getSellDiscipline(),
    getAppSettings() as any,
    getMutualFundsValued().catch(() => []),
    getSavingsValued().catch(() => []),
    getNetWorth().catch(() => null),
    getAllHoldings(),
    getEffectiveInflationPct().catch(() => ({ pct: null })),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const s = settings as TaxSettings;
  const cards: InboxCard[] = [];

  for (const p of positions) for (const t of p.fired) cards.push({ ...t, kind: "trigger" });

  // Cash as a position: funds, savings, and the brokerage balance.
  for (const f of funds) {
    const y = f.liveAnnualYieldPct ?? f.annualYieldPct;
    const net = y != null && y > 0 ? afterTaxPct(y, "dividend", s) : null;
    const plan: any = (f as any).cashPlan ?? {};
    for (const c of cashFlags({ label: f.name, purpose: plan.purpose ?? "", reviewBy: plan.reviewBy ?? "", netYieldPct: net }, today, inf.pct))
      cards.push({ ...c, kind: "cash" });
  }
  for (const a of savings) {
    const net = a.ratePercent > 0 ? afterTaxPct(a.ratePercent, "profit-on-debt", s) : null;
    const plan: any = (a as any).cashPlan ?? {};
    for (const c of cashFlags({ label: a.name, purpose: plan.purpose ?? "", reviewBy: plan.reviewBy ?? "", netYieldPct: net }, today, inf.pct))
      cards.push({ ...c, kind: "cash" });
  }

  // Re-buy reviews: exited symbols with an active rule.
  const rebuys = holdings.filter((h: any) => h.rebuyRule?.active && (h.currentShares ?? 0) <= 0);
  if (rebuys.length) {
    const prices = await getCurrentPrices(rebuys.map((h: any) => h.symbol)).catch(() => new Map());
    for (const h of rebuys as any[]) {
      for (const c of rebuyFlags(
        { symbol: h.symbol, maxPrice: h.rebuyRule.maxPrice ?? 0, reviewOn: h.rebuyRule.reviewOn ?? "", requiredConditions: h.rebuyRule.requiredConditions ?? [] },
        prices.get(h.symbol) ?? null,
        today
      ))
        cards.push({ ...c, kind: "rebuy" });
    }
  }

  const guardWarnings = positions.flatMap((p) => p.guardWarnings.map((message) => ({ symbol: p.signal.symbol, message })));

  await connectDb();
  const reviewsDue = (await DecisionModel.find({
    userId: await uid(),
    reviewDate: { $ne: "", $lte: today },
    outcomeReview: null,
  })
    .sort({ reviewDate: 1 })
    .lean()) as unknown as Decision[];

  return { cards, guardWarnings, reviewsDue, netRiskFree, inflationPct: inf.pct };
}
export const getDecisionInbox = cache(_getDecisionInbox);

// --- log access --------------------------------------------------------------

async function _getRecentDecisions(limit = 200): Promise<Decision[]> {
  await connectDb();
  return (await DecisionModel.find({ userId: await uid() }).sort({ timestamp: -1 }).limit(limit).lean()) as unknown as Decision[];
}
export const getRecentDecisions = cache(_getRecentDecisions);

export async function getDecisionsFor(symbol: string): Promise<Decision[]> {
  await connectDb();
  return (await DecisionModel.find({ userId: await uid(), symbol: symbol.toUpperCase() })
    .sort({ timestamp: -1 })
    .lean()) as unknown as Decision[];
}

// Self-scorecard: average decision QUALITY (the reasoning grade, not the
// outcome) by action type — the feedback loop that changes behaviour.
export async function getScorecard(): Promise<{
  byAction: Array<{ action: string; count: number; reviewed: number; avgQuality: number | null }>;
  total: number;
}> {
  const all = await getRecentDecisions(1000);
  const map = new Map<string, { count: number; reviewed: number; sum: number }>();
  for (const d of all) {
    const m = map.get(d.action) ?? { count: 0, reviewed: 0, sum: 0 };
    m.count++;
    if (d.outcomeReview) {
      m.reviewed++;
      m.sum += d.outcomeReview.decisionQuality;
    }
    map.set(d.action, m);
  }
  return {
    byAction: [...map.entries()]
      .map(([action, m]) => ({ action, count: m.count, reviewed: m.reviewed, avgQuality: m.reviewed ? m.sum / m.reviewed : null }))
      .sort((a, b) => b.count - a.count),
    total: all.length,
  };
}

// --- decision creation (shared by the API route and the SELL enforcement) ----

// Server-side snapshot: what the world looked like the moment the decision was
// logged — price, weights, MY fair-value band, the thesis frozen verbatim.
export async function snapshotForDecision(symbol: string): Promise<{
  price: number;
  weightPct: number;
  fv: { low: number; base: number; high: number; method: string };
  thesis: string;
  firedTriggers: string[];
  avgCost: number;
}> {
  const [{ positions }, summary, holdings] = await Promise.all([getSellDiscipline(), getPortfolioSummary(), getAllHoldings()]);
  const sym = symbol.toUpperCase();
  const pos = summary.positions.find((p) => p.symbol === sym);
  const disc = positions.find((p) => p.signal.symbol === sym);
  const h: any = holdings.find((x: any) => x.symbol === sym) ?? {};
  const plan: any = h.plan ?? {};
  let price = pos?.currentPrice ?? 0;
  if (!price) price = (await getCurrentPrices([sym]).catch(() => new Map())).get(sym) ?? 0;
  return {
    price,
    weightPct: pos?.currentPercent ?? 0,
    fv: { low: plan.fvLow ?? 0, base: plan.fvBase ?? 0, high: plan.fvHigh ?? 0, method: plan.fvMethod ?? "" },
    thesis: h.thesis ?? "",
    firedTriggers: (disc?.firedRaw ?? []).map((t) => t.type),
    avgCost: pos?.avgCost ?? h.avgCostBasis ?? 0,
  };
}
