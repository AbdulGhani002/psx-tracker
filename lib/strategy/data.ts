import "server-only";
import { cache } from "react";
import { connectDb } from "@/lib/db";
import { RateSnapshotModel } from "@/lib/models";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getAppSettings, getPortfolioSummary, getMutualFundsValued, getSavingsValued, getFixedIncomeValued, getSbpLive, getInflationLive, getIntrinsicValuations } from "@/lib/data";
import { eodSeriesCached } from "@/lib/timeseries/eod-cache";
import { getQualityBoard, getQualityFor } from "@/lib/fundamentals/board";
import { whtPct } from "@/lib/calculations/pk-tax";
import { strategyPlan, type Rates, type StrategyPlan, type RiskProfile, type Horizon, type StrategyName } from "./plan";
import { buyZones } from "./zones";
import { buyPick, sellPick, type BuyPick, type SellPick, type BuyVerdict, type SellVerdict } from "./picks";
import { median } from "@/lib/fundamentals/quality";
import { getMacroLive, type MacroLive, type Zone } from "@/lib/macro/live";
import { getWatchlist, listings } from "@/lib/watchlist";
import { latestCloses } from "@/lib/quant/sheet-bars";
import { loadQuantSnapshot } from "@/lib/quant/store";
import type { StoredReport } from "@/lib/quant/report";

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
  // A year of KSE-100 closes with the 200-day average, for the chart.
  chart: Array<{ date: string; close: number; ma200: number | null }>;
  // The Model page's read: its date, the market's state, and each name's
  // zones (the same numbers that page shows).
  model: { date: string; state: string | null; names: Record<string, NameZone> } | null;
  // The strategy model (lib/macro/live.ts): sectors ranked, times like now,
  // what moves each sector, and the model's tested record.
  macro: (Omit<MacroLive, "names" | "pe" | "sectors"> & { sectors: Array<MacroLive["sectors"][number] & { watched: boolean }> }) | null;
  // Every share of each ticked sector and every held share, researched.
  research: Research;
};

export type ResearchRow = {
  symbol: string;
  name: string;
  sector: string;
  held: boolean;
  price: number | null;
  pctile: number | null;
  thin: boolean;
  pe: number | null;
  fairPe: number | null; // the P/E it has had with the policy rate near today's
  peLo: number | null;
  peHi: number | null;
  june: Array<[string, number]>;
  dividendYieldPct: number | null;
  yieldJune: Array<[string, number]>; // the dividend yield on each 30 June
  edge: number | null; // expected return against the market over 3 months
  roePct: number | null;
  grade: string | null;
  ret12: number | null;
  offHigh: number | null;
  zone: Zone | null;
  buy: BuyPick;
  sell: SellPick | null; // held shares only
};
export type SectorResearch = { sector: string; name: string; pctile: number | null; rank: number | null; peNow: number | null; peFair: number | null; rows: ResearchRow[]; quiet: number };
export type Research = {
  asOf: string | null;
  rateNow: number | null;
  sectors: SectorResearch[]; // the ticked ones, the model's best first
  buys: ResearchRow[]; // buy now or at a price, the model's best first
  held: ResearchRow[]; // every held share, sells first
  watched: { sectors: number; shares: number };
};

export type NameZone = { price: number; buyLow: number; buyHigh: number; sellLow: number; sellHigh: number; fails: number; pctile: number };

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
  const uid = await getCurrentUserId();
  const report = uid ? await loadQuantSnapshot<StoredReport>(`quant:report:${uid}`).catch(() => null) : null;
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

  // A year of it for the chart, with the 200-day average on each day.
  const chart: StrategyView["chart"] = [];
  let sum = 0;
  for (let k = 0; k < kseSeries.length; k++) {
    sum += kseSeries[k].close;
    if (k >= 200) sum -= kseSeries[k - 200].close;
    if (k >= kseSeries.length - 260) chart.push({ date: kseSeries[k].date, close: kseSeries[k].close, ma200: k >= 199 ? sum / 200 : null });
  }

  // The Model page's read, while it is under a week old.
  const fresh = report && Date.now() - Date.parse(report.date + "T00:00:00Z") < 7 * 86400000 ? report : null;
  const kseItem = fresh?.indices.find((x) => x.symbol === "KSE100") ?? null;
  const model: StrategyView["model"] = fresh
    ? {
        date: fresh.date,
        state: fresh.market?.state ?? null,
        names: Object.fromEntries(fresh.screen.filter((r) => r.price > 0 && r.buyHigh > 0).map((r) => [r.symbol, { price: r.price, buyLow: r.buyLow, buyHigh: r.buyHigh, sellLow: r.sellLow, sellHigh: r.sellHigh, fails: r.fails, pctile: r.pctile }])),
      }
    : null;

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
  // Where to buy the index: the model's zone, past lows, a bad quarter,
  // cheap against T-bills (lib/strategy/zones.ts).
  const zones = buyZones({
    closes: kseSeries,
    model: kseItem?.zone ? { buyHigh: kseItem.zone.buyHigh, buyLow: kseItem.zone.buyLow } : null,
    pe: board?.market?.pe ?? null,
    tbillPct: rates ? rates.tbill12mPct ?? rates.tbill6mPct ?? rates.tbill3mPct ?? rates.policyPct : null,
  });
  const plan = strategyPlan({ today, profile, kse, market: board?.market ? { pe: board.market.pe, cape: board.market.cape, dividendYieldPct: board.market.dividendYieldPct } : null, rates, prevRates, book, names, zones });
  const [live, watch] = await Promise.all([getMacroLive().catch(() => null), getWatchlist().catch(() => ({ sectors: [] as string[] }))]);
  const research = await buildResearch(live, watch.sectors, model, summary.positions).catch(() => emptyResearch(watch.sectors.length));
  const watchedSet = new Set(watch.sectors);
  const macro: StrategyView["macro"] = live
    ? { asOf: live.asOf, computedAt: live.computedAt, model: live.model, state: live.state, analogs: live.analogs, rate: live.rate, learning: live.learning, sectors: live.sectors.map((x) => ({ ...x, watched: watchedSet.has(x.sector) })) }
    : null;

  // The plan's steps, with the research's: sectors to favour, what to buy and
  // where, what to sell. The quality board's own buy list gives way to it.
  const money = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : String(v));
  const steps = plan.steps.filter((x) => !x.startsWith("Buy:") && !x.startsWith("Reconsider:"));
  const favour = research.sectors.filter((x) => x.pctile != null && x.pctile >= 0.5).slice(0, 3).map((x) => x.name);
  if (favour.length) steps.push(`Favour: ${favour.join(", ")}`);
  const nowBuys = research.buys.filter((r) => r.buy.verdict === "buy").slice(0, 5);
  const atBuys = research.buys.filter((r) => r.buy.verdict === "buy-at").slice(0, 5);
  if (nowBuys.length) steps.push(`Buy now: ${nowBuys.map((r) => r.symbol).join(", ")}`);
  if (atBuys.length) steps.push(`Buy at: ${atBuys.map((r) => `${r.symbol} ${money(r.buy.buyAt!)}`).join(", ")}`);
  if (watch.sectors.length === 0) steps.push("Tick sectors on the Watchlist page");
  const sellNow = research.held.filter((r) => r.sell?.verdict === "sell").map((r) => r.symbol);
  const profit = research.held.filter((r) => r.sell?.verdict === "take-profit").map((r) => r.symbol);
  if (sellNow.length) steps.push(`Sell: ${sellNow.join(", ")}`);
  if (profit.length) steps.push(`Take profit: ${profit.join(", ")}`);
  plan.steps = steps;

  return { plan, rates, ratesEntered: prefill.entered, profile, kse, book, history, chart, model, macro, research };
}

const BUY_ORDER: Record<BuyVerdict, number> = { buy: 0, "buy-at": 1, wait: 2, avoid: 3, thin: 4, unknown: 5 };
const SELL_ORDER: Record<SellVerdict, number> = { sell: 0, "take-profit": 1, hold: 2, thin: 3, unknown: 4 };

const emptyResearch = (sectors: number): Research => ({ asOf: null, rateNow: null, sectors: [], buys: [], held: [], watched: { sectors, shares: 0 } });

// Every share of the ticked sectors and every held one: the model's rank and
// the expected edge it gives, P/E now against its usual and its history, the
// dividend yield now and on each 30 June (the exchange's record), the
// quality board's ROE and grade, its year, its zones (the Model page's where
// that page has it, else the same walk on the latest close), and what to do
// (lib/strategy/picks.ts). A share that has not traded lately and that
// nobody holds is only counted.
async function buildResearch(
  live: MacroLive | null,
  sectors: string[],
  model: StrategyView["model"],
  positions: Array<{ symbol: string; shares: number; priceKnown: boolean; currentPrice: number }>
): Promise<Research> {
  const held = new Map(positions.filter((p) => p.shares > 0).map((p) => [p.symbol, p]));
  const ticked = new Set(sectors);
  const all = listings();
  const listing = new Map(all.map((l) => [l.symbol, l]));
  const symbols = [...new Set([...all.filter((l) => ticked.has(l.sector)).map((l) => l.symbol), ...held.keys()])];
  const [quality, closes] = await Promise.all([getQualityFor(symbols).catch(() => new Map()), latestCloses().catch(() => new Map<string, { date: string; close: number }>())]);
  const liveOf = new Map((live?.names ?? []).map((n) => [n.symbol, n]));

  const rows: ResearchRow[] = [];
  const quiet = new Map<string, number>();
  for (const symbol of symbols) {
    const n = liveOf.get(symbol);
    const pos = held.get(symbol);
    const l = listing.get(symbol);
    const price = pos?.priceKnown && pos.currentPrice > 0 ? pos.currentPrice : n?.price ?? closes.get(symbol)?.close ?? null;
    const sector = l?.sector ?? n?.sector ?? "OTHER";
    if (!pos && (!n || price == null)) {
      quiet.set(sector, (quiet.get(sector) ?? 0) + 1);
      continue;
    }
    const pe = live?.pe[symbol] ?? null;
    const q = quality.get(symbol) ?? null;
    const m = model?.names[symbol];
    const zone: Zone | null = m ? { buyLow: m.buyLow, buyHigh: m.buyHigh, fails: m.fails, sellLow: m.sellLow, sellHigh: m.sellHigh } : n?.zone ?? null;
    const peNow = pe?.eps != null && pe.eps > 0 && price != null && price / pe.eps <= 200 ? price / pe.eps : null;
    const input = { symbol, price, edge: n?.edge ?? null, thin: n?.thin ?? true, zone };
    rows.push({
      symbol,
      name: l?.name ?? symbol,
      sector,
      held: !!pos,
      price,
      pctile: n?.pctile ?? null,
      thin: input.thin,
      pe: peNow,
      fairPe: pe?.fair ?? null,
      peLo: pe?.lo ?? null,
      peHi: pe?.hi ?? null,
      june: pe?.june ?? [],
      dividendYieldPct: n?.dividendYieldPct ?? q?.dividendYieldPct ?? null,
      yieldJune: n?.yieldJune ?? [],
      edge: input.edge,
      roePct: q?.roePct ?? null,
      grade: q?.grade ?? null,
      ret12: n?.ret12 ?? null,
      offHigh: n?.offHigh ?? null,
      zone,
      buy: buyPick(input),
      sell: pos ? sellPick(input) : null,
    });
  }
  const byBuy = (a: ResearchRow, b: ResearchRow) => BUY_ORDER[a.buy.verdict] - BUY_ORDER[b.buy.verdict] || (b.edge ?? -1) - (a.edge ?? -1);

  const secLive = new Map((live?.sectors ?? []).map((x, k) => [x.sector, { pctile: x.pctile, rank: k + 1 }]));
  const sectorRows: SectorResearch[] = [...ticked].map((sector) => {
    const mine = rows.filter((r) => r.sector === sector).sort(byBuy);
    const peNow = median(mine.map((r) => r.pe).filter((v): v is number => v != null && v > 0));
    const peFair = median(mine.map((r) => r.fairPe).filter((v): v is number => v != null && v > 0));
    return { sector, name: all.find((l) => l.sector === sector)?.sectorName ?? sector, pctile: secLive.get(sector)?.pctile ?? null, rank: secLive.get(sector)?.rank ?? null, peNow, peFair, rows: mine, quiet: quiet.get(sector) ?? 0 };
  });
  sectorRows.sort((a, b) => (b.pctile ?? -1) - (a.pctile ?? -1) || a.name.localeCompare(b.name));

  return {
    asOf: live?.asOf ?? null,
    rateNow: live?.rate.now ?? null,
    sectors: sectorRows,
    buys: rows.filter((r) => ticked.has(r.sector) && (r.buy.verdict === "buy" || r.buy.verdict === "buy-at")).sort(byBuy),
    held: rows.filter((r) => r.held).sort((a, b) => SELL_ORDER[a.sell?.verdict ?? "unknown"] - SELL_ORDER[b.sell?.verdict ?? "unknown"] || (a.edge ?? 2) - (b.edge ?? 2)),
    watched: { sectors: ticked.size, shares: all.filter((l) => ticked.has(l.sector)).length },
  };
}
export const getStrategy = cache(_getStrategy);
