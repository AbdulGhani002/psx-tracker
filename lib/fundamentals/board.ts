import "server-only";
import { cache } from "react";
import { connectDb } from "@/lib/db";
import { FundamentalModel } from "@/lib/models";
import { getAllHoldings, getAppSettings, getFeedSnapshot, getInflationLive, getPortfolioSummary, getSbpRateSteps, saveFeedSnapshot } from "@/lib/data";
import { policyRateOn } from "@/lib/timeseries/sbp-rate";
import { kse100Symbols } from "@/lib/quant/universe";
import { latestCloses } from "@/lib/quant/sheet-bars";
import { quality, portfolioQuality, median, dividendsTtm, type AnnualRow, type CpiPoint, type Quality, type PortfolioQuality } from "./quality";

// The quality board: every company held and every KSE-100 company, each
// through lib/fundamentals/quality.ts, with the portfolio's and the market's
// value-weighted figures beside them.
//
// The inputs that are the same for everyone (the company pages, the
// statements, the closes, the price index) are gathered once and kept for
// twenty minutes; what is the viewer's own (the positions, the prices they
// are valued at, the equity premium in their settings) is applied per request.

export type CompanyInput = {
  symbol: string;
  sector: string;
  annual: AnnualRow[];
  fiscalYearEndMonth: number | null;
  shares: number | null;
  dividendsTtm: number | null;
  balance: { periodEnd: string; equity: number; totalAssets: number; consolidated: boolean; method: string; source: string; reportTitle: string } | null;
  close: number | null;
  closeDate: string | null;
  peTtm: number | null;
  checkedAt: string | null;
};

type Inputs = { at: string; cpi: CpiPoint[]; cpiPeriod: string | null; index: string[]; companies: Record<string, CompanyInput> };

export type QualityRow = {
  symbol: string;
  sector: string;
  held: boolean;
  inIndex: boolean;
  shares: number; // held
  value: number; // the holding's market value, 0 when not held
  weightPct: number | null; // of the portfolio's equities
  price: number;
  priceFrom: "live" | "close";
  marketCap: number | null;
  q: Quality;
  balance: CompanyInput["balance"];
  fiscalYearEndMonth: number | null;
  peTtm: number | null;
  checkedAt: string | null;
};

export type QualityContext = {
  costOfEquityPct: number;
  sbpRatePct: number;
  equityRiskPremiumPct: number;
  marketMedianCape: number | null;
  cpiPeriod: string | null;
  inputsAt: string;
};

export type QualityBoard = QualityContext & {
  rows: QualityRow[];
  portfolio: PortfolioQuality;
  market: PortfolioQuality | null; // the KSE-100 names, weighted by market value
  counts: { companies: number; withStatement: number; withRoe: number; withCape: number; held: number };
};

const INPUTS_KEY = "quality:inputs:v1";
const INPUTS_TTL_MS = 20 * 60 * 1000;

async function gatherInputs(): Promise<Inputs> {
  await connectDb();
  const today = new Date().toISOString().slice(0, 10);
  const [docs, closes, infl, uni] = await Promise.all([
    FundamentalModel.find({}, { symbol: 1, sector: 1, annual: 1, fiscalYearEndMonth: 1, sharesOutstanding: 1, payouts: 1, faceValue: 1, balanceSheet: 1, peTtm: 1, qualityCheckedAt: 1 }).lean() as Promise<any[]>,
    latestCloses().catch(() => new Map<string, { date: string; close: number }>()),
    getInflationLive().catch(() => null),
    kse100Symbols().catch(() => ({ symbols: [] as string[] })),
  ]);
  const companies: Record<string, CompanyInput> = {};
  for (const d of docs) {
    const c = closes.get(d.symbol);
    const bs = d.balanceSheet;
    companies[d.symbol] = {
      symbol: d.symbol,
      sector: d.sector ?? "",
      annual: (d.annual ?? []).map((r: any) => ({ fiscalYear: r.fiscalYear, eps: r.eps ?? null, profitAfterTax: r.profitAfterTax ?? null, revenue: r.revenue ?? null, netMarginPct: r.netMarginPct ?? null, grossMarginPct: r.grossMarginPct ?? null })),
      fiscalYearEndMonth: d.fiscalYearEndMonth ?? null,
      shares: d.sharesOutstanding ?? null,
      dividendsTtm: dividendsTtm(d.payouts ?? [], d.faceValue ?? 10, today),
      balance: bs?.equity > 0 ? { periodEnd: bs.periodEnd, equity: bs.equity, totalAssets: bs.totalAssets, consolidated: !!bs.consolidated, method: bs.method ?? "", source: bs.source ?? "", reportTitle: bs.reportTitle ?? "" } : null,
      close: c?.close ?? null,
      closeDate: c?.date ?? null,
      peTtm: d.peTtm ?? null,
      checkedAt: d.qualityCheckedAt ? new Date(d.qualityCheckedAt).toISOString() : null,
    };
  }
  const cpi = (infl?.history ?? []).map((p) => ({ period: p.period, index: p.index }));
  return { at: new Date().toISOString(), cpi, cpiPeriod: cpi.length ? cpi[cpi.length - 1].period : null, index: uni.symbols, companies };
}

// One gathering at a time, however many pages ask.
let gathering: Promise<Inputs> | null = null;
export function refreshQualityInputs(): Promise<Inputs> {
  gathering ??= gatherInputs()
    .then(async (fresh) => {
      await saveFeedSnapshot(INPUTS_KEY, fresh, "ok", `${Object.keys(fresh.companies).length} companies`).catch(() => {});
      return fresh;
    })
    .finally(() => {
      gathering = null;
    });
  return gathering;
}

// Stale inputs are served at once and gathered afresh behind the page, so a
// page never waits on the gathering unless there has never been one.
async function loadInputs(): Promise<Inputs> {
  const snap = await getFeedSnapshot<Inputs>(INPUTS_KEY).catch(() => ({ data: null, updatedAt: null }) as any);
  const age = snap.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
  if (snap.data && age < INPUTS_TTL_MS) return snap.data;
  if (snap.data) {
    refreshQualityInputs().catch(() => {});
    return snap.data;
  }
  return refreshQualityInputs();
}

async function viewerRate(): Promise<{ r: number; sbp: number; erp: number }> {
  const [settings, steps] = await Promise.all([getAppSettings(), getSbpRateSteps()]);
  const erp = (settings as any)?.equityRiskPremiumPct ?? 6;
  const sbp = policyRateOn(new Date().toISOString().slice(0, 10), steps.steps) ?? 11;
  return { r: sbp + erp, sbp, erp };
}

function assess(c: CompanyInput, price: number, cpi: CpiPoint[], r: number, medianCape: number | null, manualBvps: number | null): Quality {
  return quality({
    price,
    shares: c.shares,
    annual: c.annual,
    fiscalYearEndMonth: c.fiscalYearEndMonth ?? 6,
    dividendsTtm: c.dividendsTtm,
    balance: c.balance,
    manualBvps,
    cpi,
    costOfEquityPct: r,
    marketMedianCape: medianCape,
  });
}

// The median cycle-adjusted P/E across the KSE-100: the quadrant's line
// between cheap and dear. It does not depend on the viewer.
function marketMedianCape(inp: Inputs): number | null {
  const capes: number[] = [];
  for (const s of inp.index) {
    const c = inp.companies[s];
    if (!c || !(c.close && c.close > 0)) continue;
    const q = assess(c, c.close, inp.cpi, 15, null, null);
    if (q.cape != null) capes.push(q.cape);
  }
  return capes.length >= 10 ? median(capes) : null;
}

async function _getQualityBoard(): Promise<QualityBoard> {
  const [inp, rate, summary, holdings] = await Promise.all([loadInputs(), viewerRate(), getPortfolioSummary(), getAllHoldings()]);
  const medianCape = marketMedianCape(inp);
  const bvps = new Map(holdings.map((h: any) => [h.symbol, Number(h.bookValuePerShare) > 0 ? Number(h.bookValuePerShare) : null]));
  const positions = new Map(summary.positions.filter((p) => p.shares > 0).map((p) => [p.symbol, p]));
  const equityValue = [...positions.values()].reduce((s, p) => s + (p.priceKnown ? p.marketValue : 0), 0);
  const inIndex = new Set(inp.index);

  const rows: QualityRow[] = [];
  for (const sym of new Set([...positions.keys(), ...inp.index])) {
    const c = inp.companies[sym];
    const pos = positions.get(sym);
    if (!c) continue;
    const live = pos?.priceKnown && pos.currentPrice > 0 ? pos.currentPrice : null;
    const price = live ?? c.close ?? 0;
    if (!(price > 0)) continue;
    const q = assess(c, price, inp.cpi, rate.r, medianCape, bvps.get(sym) ?? null);
    const value = pos?.priceKnown ? pos.marketValue : 0;
    rows.push({
      symbol: sym,
      sector: pos?.sector || c.sector,
      held: !!pos,
      inIndex: inIndex.has(sym),
      shares: pos?.shares ?? 0,
      value,
      weightPct: pos && equityValue > 0 ? (value / equityValue) * 100 : null,
      price,
      priceFrom: live ? "live" : "close",
      marketCap: c.shares ? c.shares * price : null,
      q,
      balance: c.balance,
      fiscalYearEndMonth: c.fiscalYearEndMonth,
      peTtm: c.peTtm,
      checkedAt: c.checkedAt,
    });
  }
  rows.sort((a, b) => Number(b.held) - Number(a.held) || b.value - a.value || (b.q.spreadPp ?? -99) - (a.q.spreadPp ?? -99));

  const held = rows.filter((r) => r.held);
  const idx = rows.filter((r) => r.inIndex && r.marketCap);
  return {
    costOfEquityPct: rate.r,
    sbpRatePct: rate.sbp,
    equityRiskPremiumPct: rate.erp,
    marketMedianCape: medianCape,
    cpiPeriod: inp.cpiPeriod,
    inputsAt: inp.at,
    rows,
    portfolio: portfolioQuality(held.map((r) => ({ value: r.value, q: r.q }))),
    market: idx.length >= 20 ? portfolioQuality(idx.map((r) => ({ value: r.marketCap!, q: r.q }))) : null,
    counts: {
      companies: rows.length,
      withStatement: rows.filter((r) => r.q.bookSource === "statement").length,
      withRoe: rows.filter((r) => r.q.roePct != null).length,
      withCape: rows.filter((r) => r.q.cape != null).length,
      held: held.length,
    },
  };
}
export const getQualityBoard = cache(_getQualityBoard);

// One company, for its own page: from the board when it is on it, else
// assessed on its own against the same market line (a watchlist name outside
// the index). null when the exchange's page has never been read for it.
export async function getCompanyQuality(symbol: string): Promise<{ row: QualityRow; ctx: QualityContext } | null> {
  const sym = symbol.toUpperCase();
  const board = await getQualityBoard();
  const ctx: QualityContext = { costOfEquityPct: board.costOfEquityPct, sbpRatePct: board.sbpRatePct, equityRiskPremiumPct: board.equityRiskPremiumPct, marketMedianCape: board.marketMedianCape, cpiPeriod: board.cpiPeriod, inputsAt: board.inputsAt };
  const onBoard = board.rows.find((r) => r.symbol === sym);
  if (onBoard) return { row: onBoard, ctx };
  const inp = await loadInputs();
  const c = inp.companies[sym];
  if (!c || !(c.close && c.close > 0)) return null;
  const holdings = await getAllHoldings();
  const h: any = holdings.find((x) => x.symbol === sym);
  const manual = h && Number(h.bookValuePerShare) > 0 ? Number(h.bookValuePerShare) : null;
  const q = assess(c, c.close, inp.cpi, board.costOfEquityPct, board.marketMedianCape, manual);
  return {
    row: { symbol: sym, sector: c.sector, held: false, inIndex: false, shares: 0, value: 0, weightPct: null, price: c.close, priceFrom: "close", marketCap: c.shares ? c.shares * c.close : null, q, balance: c.balance, fiscalYearEndMonth: c.fiscalYearEndMonth, peTtm: c.peTtm, checkedAt: c.checkedAt },
    ctx,
  };
}
