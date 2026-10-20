import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, FundamentalModel, HoldingModel, ShareEventModel } from "@/lib/models";
import { getCurrentPrices, getFeedSnapshot, getInflationLive, getSbpRateSteps, getTbill12mPct, saveFeedSnapshot } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getTbillAuctions } from "@/lib/feeds/tbill-auctions";
import { auctionOn } from "@/lib/feeds/tbill-parse";
import { policyRateOn } from "@/lib/timeseries/sbp-rate";
import { buildHistory, cpiYoy, type CompanyInput, type FairPeBoard, type FairPeInputs, type History, type Macro } from "./calc";

// The sector valuation page's data: every company with a sector, its shares
// and its profits (from the company pages), its closes at each 30 June (the
// adjusted series for value, the actual close for yields) and now, and its
// cash dividends (ShareEvent). The history is kept for a few hours; the rates
// you enter are kept per user. Rates the app already holds (SBP's auctions,
// the policy rate's steps, the CPI index) fill what you leave empty.

const HISTORY_KEY = "fairpe:history:v1";
const HISTORY_TTL_MS = 3 * 3600_000;
const FIRST_YEAR = 2016;
const DAY = 86400000;
const inputsKey = (uid: string) => `fairpe:inputs:${uid}`;
const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function junes(today: string): string[] {
  const last = today >= `${today.slice(0, 4)}-06-30` ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const out: string[] = [];
  for (let y = FIRST_YEAR; y <= last; y++) out.push(`${y}-06-30`);
  return out;
}

async function buildFairPeHistory(): Promise<History> {
  await connectDb();
  const today = pkToday();
  const dates = junes(today);
  const funds = (await FundamentalModel.find({ sector: { $nin: ["", null] }, sharesOutstanding: { $gt: 0 } }, { symbol: 1, sector: 1, sharesOutstanding: 1, fiscalYearEndMonth: 1, annual: 1, peTtm: 1 }).lean()) as any[];
  const symbols = funds.map((f) => String(f.symbol));
  // Each 30 June's adjusted close: the last within ten days before it.
  const pairs = dates.map((d) => ({ d, lo: iso(Date.parse(d + "T00:00:00Z") - 10 * DAY) }));
  const adjDocs = (await FeedSnapshotModel.aggregate([
    { $match: { key: { $in: symbols.map((s) => `eod:bars:${s}`) } } },
    { $project: { key: 1, at: { $map: { input: { $literal: pairs }, as: "p", in: { $arrayElemAt: [{ $filter: { input: "$data.bars", as: "b", cond: { $and: [{ $lte: ["$$b.date", "$$p.d"] }, { $gt: ["$$b.date", "$$p.lo"] }] } } }, -1] } } } } },
  ])) as any[];
  const adj = new Map<string, Array<{ close?: number } | null>>(adjDocs.map((d) => [String(d.key).slice("eod:bars:".length), d.at ?? []]));
  const fy: any = await FeedSnapshotModel.findOne({ key: "prices:fy-closes" }, Object.fromEntries(dates.map((d) => [`data.${d}`, 1]))).lean();
  const actualOn = (d: string, s: string): number | null => {
    const v = fy?.data?.[d]?.[s];
    const n = typeof v === "number" ? v : Number(v?.close);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const prices = await getCurrentPrices(symbols).catch(() => new Map<string, number>());
  const events = (await ShareEventModel.find({ symbol: { $in: symbols }, kind: "cash", date: { $gt: `${FIRST_YEAR - 1}-06-30` } }, { symbol: 1, date: 1, cash: 1 }).lean()) as any[];
  const cashOf = new Map<string, Array<{ date: string; cash: number }>>();
  for (const e of events) {
    const list = cashOf.get(e.symbol) ?? [];
    if (e.cash > 0) list.push({ date: String(e.date), cash: Number(e.cash) });
    cashOf.set(e.symbol, list);
  }

  const companies: CompanyInput[] = [];
  const excluded: History["excluded"] = [];
  for (const f of funds) {
    const s = String(f.symbol);
    const at: CompanyInput["at"] = {};
    const adjAt = adj.get(s) ?? [];
    dates.forEach((d, i) => {
      const a = adjAt[i]?.close;
      at[d] = { adj: typeof a === "number" && a > 0 ? a : null, actual: actualOn(d, s) };
    });
    const c: CompanyInput = {
      symbol: s,
      sector: String(f.sector),
      shares: Number(f.sharesOutstanding),
      fyEndMonth: Number(f.fiscalYearEndMonth) >= 1 && Number(f.fiscalYearEndMonth) <= 12 ? Number(f.fiscalYearEndMonth) : 6,
      // The company pages give profit in thousands of rupees.
      annual: ((f.annual ?? []) as any[]).filter((a) => a.profitAfterTax != null).map((a) => ({ fiscalYear: Number(a.fiscalYear), profit: Number(a.profitAfterTax) * 1000 })),
      at,
      priceNow: prices.get(s) ?? null,
      cash: cashOf.get(s) ?? [],
    };
    // A company whose P/E now is far from the one its page shows has figures
    // on another footing (units, a split the profit missed): left out.
    const one = buildHistory([c], [], pkToday()).companies[0];
    const ttm = Number(f.peTtm);
    if (one.now.pe != null && ttm > 0 && (one.now.pe / ttm > 3 || ttm / one.now.pe > 3)) {
      excluded.push({ symbol: s, why: `P/E ${one.now.pe.toFixed(1)} against ${ttm.toFixed(1)} on its page` });
      continue;
    }
    companies.push(c);
  }
  return buildHistory(companies, dates, today, excluded);
}

export async function getFairPeHistory(rebuild = false): Promise<{ history: History; builtAt: string }> {
  const kept = await getFeedSnapshot<History>(HISTORY_KEY).catch(() => null);
  const age = kept?.updatedAt ? Date.now() - new Date(kept.updatedAt).getTime() : Infinity;
  if (!rebuild && kept?.data && age < HISTORY_TTL_MS && kept.data.dates?.length) return { history: kept.data, builtAt: new Date(kept.updatedAt!).toISOString() };
  const history = await buildFairPeHistory();
  await saveFeedSnapshot(HISTORY_KEY, history, "ok", `${history.companies.length} companies, ${history.dates.length} years`).catch(() => {});
  return { history, builtAt: new Date().toISOString() };
}

export async function getFairPeInputs(userId?: string): Promise<FairPeInputs> {
  const id = userId ?? (await getCurrentUserId()) ?? "";
  const s = await getFeedSnapshot<FairPeInputs>(inputsKey(id)).catch(() => null);
  return { now: s?.data?.now ?? {}, years: s?.data?.years ?? {}, skip: s?.data?.skip ?? [], watch: s?.data?.watch ?? [] };
}

export async function saveFairPeInputs(userId: string, inputs: FairPeInputs): Promise<void> {
  await saveFeedSnapshot(inputsKey(userId), inputs, "ok", "fair P/E rates");
}

// What the app already holds for each 30 June and now: SBP's last 12-month
// auction before the date, the policy rate (its steps go back to June 2023)
// and June's year-on-year CPI.
async function knownMacro(dates: string[], today: string): Promise<FairPeBoard["known"]> {
  const [auctions, steps, cpi, tbillNow] = await Promise.all([
    getTbillAuctions().catch(() => []),
    getSbpRateSteps().catch(() => null),
    getInflationLive().catch(() => null),
    getTbill12mPct().catch(() => null),
  ]);
  const st = steps?.steps ?? [];
  const oldest = st.length ? st.map((s) => s.from).sort()[0] : null;
  const years: Record<string, Macro> = {};
  for (const d of dates) {
    years[d.slice(0, 4)] = {
      tbill: auctionOn(auctions, d, 31)?.m12 ?? null,
      policy: oldest && d >= oldest ? policyRateOn(d, st) : null,
      cpi: cpi?.history?.length ? cpiYoy(cpi.history, d.slice(0, 7)) : null,
    };
  }
  return { years, now: { tbill: tbillNow, policy: st.length ? policyRateOn(today, st) : null, cpi: cpi?.yoyPct ?? null } };
}

export async function getFairPeBoard(opts: { rebuild?: boolean } = {}): Promise<FairPeBoard> {
  await connectDb();
  const userId = (await getCurrentUserId()) ?? "";
  const [{ history, builtAt }, inputs, held] = await Promise.all([
    getFairPeHistory(opts.rebuild),
    getFairPeInputs(userId),
    HoldingModel.distinct("symbol", { userId, currentShares: { $gt: 0 } }) as Promise<string[]>,
  ]);
  const known = await knownMacro(history.dates, pkToday());
  return { history, inputs, known, held: held.sort(), builtAt };
}
