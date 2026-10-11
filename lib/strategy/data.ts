import "server-only";
import { cache } from "react";
import { connectDb } from "@/lib/db";
import { RateSnapshotModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getAppSettings, getPortfolioSummary, getMutualFundsValued, getSavingsValued, getFixedIncomeValued, getSbpLive, getInflationLive, getIntrinsicValuations } from "@/lib/data";
import { eodSeriesCached } from "@/lib/timeseries/eod-cache";
import { getQualityBoard } from "@/lib/fundamentals/board";
import { whtPct } from "@/lib/calculations/pk-tax";
import { strategyPlan, type Rates, type StrategyPlan, type RiskProfile, type Horizon, type StrategyName } from "./plan";

// The strategy page's inputs, gathered: the month's rates (as entered, else
// prefilled from SBP and PBS), the KSE-100's level against its 52-week high
// and 200-day average, the market's multiples (the quality board's KSE-100
// figures), the book split into stocks and dry powder, and every name's
// grade (lib/strategy/plan.ts applies the rules).

export type RatesPrefill = { values: Rates; sources: Partial<Record<keyof Rates, string>>; entered: boolean };

const monthOf = (d = new Date()) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function toRates(d: any): Rates {
  return { month: d.month, policyPct: num(d.policyPct), tbill3mPct: num(d.tbill3mPct), tbill6mPct: num(d.tbill6mPct), tbill12mPct: num(d.tbill12mPct), sukukPct: num(d.sukukPct), savingsPct: num(d.savingsPct), moneyMarketPct: num(d.moneyMarketPct), inflationPct: num(d.inflationPct), taxPct: num(d.taxPct) ?? 15 };
}

async function _getRateSnapshots(): Promise<Rates[]> {
  const uid = await getCurrentUserId();
  if (!uid) return [];
  await connectDb();
  const docs = await RateSnapshotModel.find({ userId: uid }).sort({ month: -1 }).limit(36).lean();
  return docs.map(toRates);
}
export const getRateSnapshots = cache(_getRateSnapshots);

// This month's form: what was entered for it, else last month's figures
// carried forward with whatever SBP, PBS and your own accounts say now.
async function _getRatesPrefill(): Promise<RatesPrefill> {
  const month = monthOf();
  const [snaps, sbp, infl, savings, funds, settings] = await Promise.all([getRateSnapshots(), getSbpLive().catch(() => null), getInflationLive().catch(() => null), getSavingsValued().catch(() => []), getMutualFundsValued().catch(() => []), getAppSettings()]);
  const mine = snaps.find((s) => s.month === month);
  if (mine) return { values: mine, sources: {}, entered: true };
  const last = snaps[0];
  // SBP's copy counts as this month's only while it is fresh; an old one
  // gives way to what you entered last, and is labelled old when it is all
  // there is.
  const sbpFresh = !!sbp?.rates.fetchedAt && Date.now() - Date.parse(sbp.rates.fetchedAt) < 20 * 86400000;
  const r = sbpFresh || !last ? sbp?.rates : undefined;
  const cut = (t: string) => r?.mtbCutoffs.find((c) => c.tenor === t)?.yieldPct ?? null;
  const pib5 = r?.pibCutoffs.find((c) => c.tenor === "5Y")?.yieldPct ?? r?.pibCutoffs.find((c) => c.tenor === "3Y")?.yieldPct ?? null;
  const bestSavings = savings.length ? Math.max(...savings.map((a) => a.ratePercent || 0)) : null;
  const mmf = funds.filter((f) => f.moneyMarket).map((f) => f.liveAnnualYieldPct ?? f.annualYieldPct ?? 0).filter((y) => y > 0);
  const sbpDate = r?.fetchedAt ? `${r.fetchedAt.slice(0, 10)}${sbpFresh ? "" : ", old"}` : null;
  const sources: RatesPrefill["sources"] = {};
  const pick = <K extends keyof Rates>(k: K, live: Rates[K] | null, src: string): Rates[K] | null => {
    if (live != null) { sources[k] = src; return live; }
    if (last && last[k] != null) { sources[k] = `as you entered for ${last.month}`; return last[k]; }
    return null;
  };
  const values: Rates = {
    month,
    policyPct: pick("policyPct", r?.policyRatePct ?? null, `SBP, ${sbpDate}`),
    tbill3mPct: pick("tbill3mPct", cut("3M"), `SBP auction cut-off, ${sbpDate}`),
    tbill6mPct: pick("tbill6mPct", cut("6M"), `SBP auction cut-off, ${sbpDate}`),
    tbill12mPct: pick("tbill12mPct", cut("12M"), `SBP auction cut-off, ${sbpDate}`),
    sukukPct: pick("sukukPct", last?.sukukPct != null ? null : pib5, "the 5-year PIB yield, as a stand-in: enter the sukuk's own"),
    savingsPct: pick("savingsPct", bestSavings && bestSavings > 0 ? bestSavings : null, "your best savings account"),
    moneyMarketPct: pick("moneyMarketPct", mmf.length ? Math.max(...mmf) : null, "your money market fund, its last year"),
    inflationPct: pick("inflationPct", infl?.yoyPct != null ? Math.round(infl.yoyPct * 100) / 100 : null, `PBS CPI, ${infl?.latest?.period ?? ""}`),
    taxPct: whtPct("profit-on-debt", settings as any),
  } as Rates;
  return { values, sources, entered: false };
}
export const getRatesPrefill = cache(_getRatesPrefill);

export type StrategyView = {
  plan: StrategyPlan;
  rates: Rates | null;
  ratesEntered: boolean; // this month's rates are the user's own
  profile: { risk: RiskProfile; horizon: Horizon };
  kse: { level: number; high: number; highDate: string; ma200: number | null; asOf: string } | null;
  book: { stocks: number; equityFunds: number; cashLike: number; fixedIncome: number };
  history: Rates[];
};

async function _getStrategy(): Promise<StrategyView> {
  const [settings, prefill, history, summary, funds, savings, fixed, kseSeries, board, intr] = await Promise.all([
    getAppSettings(),
    getRatesPrefill(),
    getRateSnapshots(),
    getPortfolioSummary(),
    getMutualFundsValued().catch(() => []),
    getSavingsValued().catch(() => []),
    getFixedIncomeValued().catch(() => []),
    eodSeriesCached("KSE100").catch(() => []),
    getQualityBoard().catch(() => null),
    getIntrinsicValuations().catch(() => null),
  ]);
  const profile = { risk: (["defensive", "balanced", "aggressive"].includes((settings as any).strategyRisk) ? (settings as any).strategyRisk : "balanced") as RiskProfile, horizon: (["short", "medium", "long"].includes((settings as any).strategyHorizon) ? (settings as any).strategyHorizon : "long") as Horizon };

  // The KSE-100: today, its high over the last year, its 200-day average.
  let kse: StrategyView["kse"] = null;
  if (kseSeries.length > 0) {
    const last = kseSeries[kseSeries.length - 1];
    const year = kseSeries.slice(-252);
    const top = year.reduce((m, p) => (p.close > m.close ? p : m), year[0]);
    const tail = kseSeries.slice(-200);
    kse = { level: last.close, high: top.close, highDate: top.date, ma200: tail.length === 200 ? tail.reduce((s, p) => s + p.close, 0) / 200 : null, asOf: last.date };
  }

  // The book: stocks and equity funds against the dry powder (money market,
  // savings, T-bills and sukuks). The brokerage balance is left out, as net
  // worth leaves it out: the ledger behind it is incomplete.
  const moneyMarket = funds.filter((f) => f.moneyMarket).reduce((s, f) => s + f.value, 0);
  const equityFunds = funds.filter((f) => !f.moneyMarket).reduce((s, f) => s + f.value, 0);
  const book = {
    stocks: summary.totalValue,
    equityFunds,
    cashLike: moneyMarket + savings.reduce((s, a) => s + a.balance, 0),
    fixedIncome: fixed.filter((f) => !f.matured).reduce((s, f) => s + f.value, 0),
  };

  // Every name the quality board grades, with the margin of safety the
  // intrinsic valuation gives a held one.
  const mos = new Map((intr?.items ?? []).map((i) => [i.symbol, i.marginOfSafetyPct ?? null]));
  const names: StrategyName[] = (board?.rows ?? []).map((r) => ({ symbol: r.symbol, held: r.held, value: r.value, grade: r.q.grade, quadrant: r.q.quadrant, roeSpreadPp: r.q.spreadPp, dividendYieldPct: r.q.dividendYieldPct, marginOfSafetyPct: mos.get(r.symbol) ?? null }));

  const rates = prefill.values.policyPct != null || prefill.values.tbill12mPct != null ? prefill.values : null;
  const prevRates = history.find((h) => h.month < (rates?.month ?? "9999")) ?? null;
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const plan = strategyPlan({ today, profile, kse, market: board?.market ? { pe: board.market.pe, cape: board.market.cape, dividendYieldPct: board.market.dividendYieldPct } : null, rates, prevRates, book, names });
  return { plan, rates, ratesEntered: prefill.entered, profile, kse, book, history };
}
export const getStrategy = cache(_getStrategy);
