// What the overview and analytics pages read: today's profit name by name,
// each portfolio's value, the latest activity, dividend yields, and the
// performance series with its monthly table. Everything here is derived
// from the same readers the rest of the app uses, so no page can disagree
// with another.

import "server-only";
import { cache } from "react";
import { getAllTransactions, getPortfolioSummary, getMutualFundsValued, getSavingsValued, getCashEntries, getCashSummary, getNetWorth, getAllHoldings } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { computeBenchmarkCached } from "@/lib/feeds/benchmark";
import { eodBarsCached } from "@/lib/timeseries/eod-cache";
import { listPortfolios, filterFor, type PortfolioView } from "@/lib/portfolios";
import { connectDb } from "@/lib/db";
import { TransactionModel } from "@/lib/models/Transaction";
import { MutualFundModel } from "@/lib/models/MutualFund";
import { SavingsAccountModel } from "@/lib/models/SavingsAccount";
import { deriveFromTransactions } from "@/lib/calculations";
import { monthlyReturns, monthlyTable, drawdowns, dailyPnl, summarise, type MonthlyTable, type Drawdown, type DailyPnl, type PerfSummary } from "./performance";
import type { BenchmarkPoint } from "@/lib/timeseries/portfolio-history";

export type NameDay = {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  prevClose: number;
  changePct: number;
  profit: number; // shares x (price - prevClose)
  value: number;
  weightPct: number;
  asOf: string;
  high52: number;
  low52: number;
  avgVolume20: number;
  volume: number;
};

export type TodayView = {
  asOf: string; // the session the prices are from
  profit: number;
  profitPct: number; // against yesterday's value
  valueNow: number;
  names: NameDay[]; // every held name, best day first
  gainers: NameDay[];
  losers: NameDay[];
};

// Today's profit and loss, from the last two closes in the bars cache.
async function _getToday(): Promise<TodayView> {
  const summary = await getPortfolioSummary();
  const held = summary.positions.filter((p) => p.shares > 0);
  const bars = await eodBarsCached(held.map((p) => p.symbol));
  const names: NameDay[] = [];
  let asOf = "";
  for (const p of held) {
    const b = bars.get(p.symbol);
    if (!b || b.length < 2) continue;
    const last = b[b.length - 1], prev = b[b.length - 2];
    if (!(prev.close > 0)) continue;
    const year = b.slice(-250);
    const vol20 = b.slice(-21, -1).reduce((s, x) => s + x.volume, 0) / Math.max(1, Math.min(20, b.length - 1));
    if (last.date > asOf) asOf = last.date;
    names.push({
      symbol: p.symbol,
      name: p.name,
      shares: p.shares,
      price: last.close,
      prevClose: prev.close,
      changePct: (last.close / prev.close - 1) * 100,
      profit: p.shares * (last.close - prev.close),
      value: p.shares * last.close,
      weightPct: 0,
      asOf: last.date,
      high52: Math.max(...year.map((x) => x.close)),
      low52: Math.min(...year.map((x) => x.close)),
      avgVolume20: vol20,
      volume: last.volume,
    });
  }
  const valueNow = names.reduce((s, n) => s + n.value, 0);
  const valuePrev = names.reduce((s, n) => s + n.shares * n.prevClose, 0);
  for (const n of names) n.weightPct = valueNow > 0 ? (n.value / valueNow) * 100 : 0;
  names.sort((a, b) => b.changePct - a.changePct);
  const profit = valueNow - valuePrev;
  return {
    asOf,
    profit,
    profitPct: valuePrev > 0 ? (profit / valuePrev) * 100 : 0,
    valueNow,
    names,
    gainers: names.filter((n) => n.changePct > 0).slice(0, 5),
    losers: names.filter((n) => n.changePct < 0).slice(-5).reverse(),
  };
}
export const getToday = cache(_getToday);

export type PortfolioCard = {
  portfolio: PortfolioView;
  equity: number;
  funds: number;
  savings: number;
  total: number;
  change30Pct: number | null; // the equities held today, priced 30 sessions ago
  spark: number[]; // equity value over the last 30 sessions at today's shares
  names: number;
  invested: number; // cost of the shares held
  unrealized: number;
  realized: number;
  dividends: number;
  totalReturn: number;
  dayProfit: number; // today's move on the shares held
  dayPct: number | null;
};

// Each portfolio valued on its own: positions from its own rows at today's
// prices, its funds and savings at their current value.
async function _getPortfolioCards(): Promise<PortfolioCard[]> {
  const uid = await getCurrentUserId();
  if (!uid) return [];
  const portfolios = await listPortfolios();
  await connectDb();
  const [funds, savings] = await Promise.all([MutualFundModel.find({ userId: uid }).lean(), SavingsAccountModel.find({ userId: uid }).lean()]);
  const fundsValued = await getMutualFundsValued().catch(() => [] as any[]);
  const savingsValued = await getSavingsValued().catch(() => [] as any[]);
  const fundValueById = new Map(fundsValued.map((f: any) => [String(f._id ?? f.id), f.value ?? 0]));
  const savingsById = new Map(savingsValued.map((a: any) => [String(a._id ?? a.id), a.balance ?? 0]));
  const out: PortfolioCard[] = [];
  const allSymbols = new Set<string>();
  const perPortfolio: Array<{ p: PortfolioView; shares: Map<string, number>; invested: number; realized: number; dividends: number }> = [];
  for (const p of portfolios) {
    const txs = await TransactionModel.find({ userId: uid, deletedAt: null, ...filterFor(p) }).sort({ date: 1, createdAt: 1 }).lean();
    const bySymbol = new Map<string, any[]>();
    for (const t of txs) (bySymbol.get(t.symbol) ?? bySymbol.set(t.symbol, []).get(t.symbol)!).push(t);
    const shares = new Map<string, number>();
    let invested = 0, realized = 0, dividends = 0;
    for (const [s, list] of bySymbol) {
      const d = deriveFromTransactions(list as any);
      realized += d.realizedPL;
      dividends += d.dividendsReceived;
      if (d.shares > 0) {
        shares.set(s, d.shares);
        invested += d.totalCost;
        allSymbols.add(s);
      }
    }
    perPortfolio.push({ p, shares, invested, realized, dividends });
  }
  const bars = await eodBarsCached([...allSymbols]);
  for (const { p, shares, invested, realized, dividends } of perPortfolio) {
    let equity = 0, equity30 = 0, prev = 0;
    const spark = new Array<number>(30).fill(0);
    for (const [s, n] of shares) {
      const b = bars.get(s);
      if (!b || b.length === 0) continue;
      const last = b[b.length - 1].close;
      equity += n * last;
      prev += n * (b[b.length - 2]?.close ?? last);
      const back = b[Math.max(0, b.length - 31)].close;
      equity30 += n * back;
      const tail = b.slice(-30);
      for (let i = 0; i < 30; i++) spark[i] += n * (tail[i - (30 - tail.length)]?.close ?? tail[0].close);
    }
    const inPf = (doc: any) => (p.isDefault ? !doc.portfolioId || doc.portfolioId === p._id : doc.portfolioId === p._id);
    const fundsTotal = funds.filter(inPf).reduce((s, f) => s + (fundValueById.get(String(f._id)) ?? 0), 0);
    const savingsTotal = savings.filter(inPf).reduce((s, a) => s + (savingsById.get(String(a._id)) ?? 0), 0);
    const unrealized = equity - invested;
    out.push({
      portfolio: p,
      equity,
      funds: fundsTotal,
      savings: savingsTotal,
      total: equity + fundsTotal + savingsTotal,
      change30Pct: equity30 > 0 ? (equity / equity30 - 1) * 100 : null,
      spark,
      names: shares.size,
      invested,
      unrealized,
      realized,
      dividends,
      totalReturn: unrealized + realized + dividends,
      dayProfit: equity - prev,
      dayPct: prev > 0 ? ((equity - prev) / prev) * 100 : null,
    });
  }
  return out;
}
export const getPortfolioCards = cache(_getPortfolioCards);

export type Activity = { date: string; kind: string; symbol: string; text: string; amount: number; tone: "positive" | "negative" | "muted" };

// The latest things that happened, trades and cash together.
export async function getRecentActivity(limit = 8): Promise<Activity[]> {
  const [txs, cash] = await Promise.all([getAllTransactions(), getCashEntries().catch(() => [])]);
  const items: Activity[] = [];
  for (const t of txs.slice(0, 40)) {
    const d = new Date(t.date).toISOString().slice(0, 10);
    if (t.type === "BUY" || t.type === "RIGHT") items.push({ date: d, kind: t.type === "RIGHT" ? "Rights" : "Bought", symbol: t.symbol, text: `${Math.abs(t.shares).toLocaleString()} @ ${t.pricePerShare.toFixed(2)}`, amount: -t.netAmount, tone: "muted" });
    else if (t.type === "SELL") items.push({ date: d, kind: "Sold", symbol: t.symbol, text: `${Math.abs(t.shares).toLocaleString()} @ ${t.pricePerShare.toFixed(2)}`, amount: t.netAmount, tone: "positive" });
    else if (t.type === "DIVIDEND") items.push({ date: d, kind: "Dividend", symbol: t.symbol, text: `${Math.abs(t.shares).toLocaleString()} sh × ${t.pricePerShare.toFixed(2)}`, amount: t.netAmount, tone: "positive" });
    else if (t.type === "BONUS") items.push({ date: d, kind: "Bonus", symbol: t.symbol, text: `${Math.abs(t.shares).toLocaleString()} shares`, amount: 0, tone: "muted" });
    else if (t.type === "SPLIT") items.push({ date: d, kind: "Split", symbol: t.symbol, text: t.ratio, amount: 0, tone: "muted" });
  }
  for (const c of (cash as any[]).slice(0, 20)) {
    const d = new Date(c.date).toISOString().slice(0, 10);
    items.push({ date: d, kind: c.type === "DEPOSIT" ? "Deposit" : "Withdrawal", symbol: "CASH", text: (c.notes || "").slice(0, 60), amount: c.type === "DEPOSIT" ? c.amount : -c.amount, tone: c.type === "DEPOSIT" ? "positive" : "negative" });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, limit);
}

export type YieldRow = { symbol: string; name: string; shares: number; price: number; cost: number; value: number; ttmDividends: number; ttmPerShare: number; yieldOnPricePct: number; yieldOnCostPct: number; allTimeDividends: number; lastPaid: string | null };

// Dividend yields per held name: the last twelve months of dividends against
// today's price and against what was paid.
export async function getYields(): Promise<{ rows: YieldRow[]; ttmTotal: number; portfolioYieldPct: number; yieldOnCostPct: number }> {
  const [summary, txs] = await Promise.all([getPortfolioSummary(), getAllTransactions()]);
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const rows: YieldRow[] = [];
  for (const p of summary.positions.filter((x) => x.shares > 0)) {
    const divs = txs.filter((t) => t.symbol === p.symbol && t.type === "DIVIDEND");
    const ttm = divs.filter((t) => new Date(t.date).toISOString().slice(0, 10) >= cutoff);
    const ttmDividends = ttm.reduce((s, t) => s + t.netAmount, 0);
    const ttmPerShare = ttm.reduce((s, t) => s + (t.pricePerShare || 0), 0);
    const last = divs.length ? divs.map((t) => new Date(t.date).toISOString().slice(0, 10)).sort().pop()! : null;
    rows.push({
      symbol: p.symbol,
      name: p.name,
      shares: p.shares,
      price: p.currentPrice,
      cost: p.totalCost,
      value: p.marketValue,
      ttmDividends,
      ttmPerShare,
      yieldOnPricePct: p.currentPrice > 0 && ttmPerShare > 0 ? (ttmPerShare / p.currentPrice) * 100 : 0,
      yieldOnCostPct: p.avgCost > 0 && ttmPerShare > 0 ? (ttmPerShare / p.avgCost) * 100 : 0,
      allTimeDividends: p.dividendsReceived,
      lastPaid: last,
    });
  }
  rows.sort((a, b) => b.yieldOnPricePct - a.yieldOnPricePct);
  const ttmTotal = rows.reduce((s, r) => s + r.ttmDividends, 0);
  const value = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  return { rows, ttmTotal, portfolioYieldPct: value > 0 ? (ttmTotal / value) * 100 : 0, yieldOnCostPct: cost > 0 ? (ttmTotal / cost) * 100 : 0 };
}

export type Performance = {
  range: string;
  points: BenchmarkPoint[];
  summary: PerfSummary | null;
  monthly: MonthlyTable;
  monthlyBench: MonthlyTable;
  drawdown: Drawdown;
  daily: DailyPnl[];
  stale: boolean;
};

// The performance view for a range: the series, the monthly tables for the
// portfolio and the KSE-100, drawdowns and the daily profit.
export async function getPerformance(range = "ALL"): Promise<Performance | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const r = await computeBenchmarkCached(range, uid);
  if (!r.series) return null;
  const pts = r.series.points;
  const monthly = monthlyTable(monthlyReturns(pts.map((p) => ({ date: p.date, v: p.portfolio }))));
  const monthlyBench = monthlyTable(monthlyReturns(pts.map((p) => ({ date: p.date, v: p.kse100 }))));
  return { range, points: pts, summary: summarise(pts), monthly, monthlyBench, drawdown: drawdowns(pts.map((p) => ({ date: p.date, v: p.portfolio }))), daily: dailyPnl(pts), stale: r.stale };
}

export type Allocation = { label: string; value: number };

// The book by asset class, for the donut and the invested figure.
export async function getAllocation(): Promise<{ slices: Allocation[]; total: number; invested: number; availableCash: number; equity: number; funds: number; savings: number; brokerCash: number }> {
  const [nw, summary, cashSum] = await Promise.all([getNetWorth(), getPortfolioSummary(), getCashSummary().catch(() => null)]);
  const brokerCash = Math.max(0, cashSum?.balance ?? 0);
  const slices: Allocation[] = [
    { label: "Equities", value: nw.equity },
    { label: "Money-market funds", value: nw.funds },
    { label: "Savings", value: nw.savings },
    { label: "Brokerage cash", value: brokerCash },
  ].filter((s) => s.value > 0);
  return { slices, total: nw.total + brokerCash, invested: summary.totalCost, availableCash: nw.funds + brokerCash, equity: nw.equity, funds: nw.funds, savings: nw.savings, brokerCash };
}

export async function heldSymbols(): Promise<string[]> {
  const holdings = await getAllHoldings();
  return holdings.filter((h: any) => (h.currentShares ?? 0) > 0).map((h: any) => h.symbol);
}
