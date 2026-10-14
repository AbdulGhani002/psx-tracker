import "server-only";
import { cache } from "react";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, RateSnapshotModel } from "@/lib/models";
import { getAllTransactions, getPortfolioSummary, getMutualFundsValued, getSavingsValued, getFixedIncomeValued, getSbpRateSteps, getTaxYears, getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { buildLots } from "@/lib/calculations/lots";
import { latestCloses, loadStoredBars, SHEET_PREFIX } from "@/lib/quant/sheet-bars";
import { fyOf, fyWindow, fyProfit, type FyTx, type FyProfit } from "./fy-profit";
import { indexChangePct, otherByYear, policyPct, tbillFor, tbillPct, type OtherYear, type TbillSource } from "./fy-extra";
import { getTbillAuctions } from "@/lib/feeds/tbill-auctions";

// Every financial year since the first trade, worked out by fy-profit.ts.
//
// Prices at each year's end are the exchange's actual closes on its last
// trading day: from `prices:fy-closes`, kept from the archive's daily files
// (scripts/fy-closes.ts), or from the closing sheets the server keeps for
// the years after it. The year not yet over ends at today's prices.

const FY_CLOSES_KEY = "prices:fy-closes";
const DAY = 86400000;

async function closesOn(date: string): Promise<Map<string, number>> {
  await connectDb();
  const kept: any = await FeedSnapshotModel.findOne({ key: FY_CLOSES_KEY }, { [`data.${date}`]: 1 }).lean();
  const row = kept?.data?.[date];
  if (row && Object.keys(row).length > 0) return new Map(Object.entries(row as Record<string, number>));
  // The closing sheets on or before the date: the last close of each name.
  const from = new Date(Date.parse(date + "T00:00:00Z") - 30 * DAY).toISOString().slice(0, 10);
  const docs = (await FeedSnapshotModel.find({ key: { $gte: SHEET_PREFIX + from, $lte: SHEET_PREFIX + date }, status: { $ne: "holiday" } }, { key: 1, data: 1 }).sort({ key: -1 }).limit(25).lean()) as any[];
  const out = new Map<string, number>();
  for (const d of docs) for (const r of d.data?.rows ?? []) if (!out.has(r[0]) && r[4] > 0) out.set(r[0], r[4]);
  return out;
}

// A year's share profit with the rest of the book beside it, the CGT on its
// sales (the Tax tab's) and the market over the same year.
export type YearRow = FyProfit & {
  other: OtherYear;
  total: number; // shares and the rest of the book
  cgt: number | null;
  // tbillRate: the rate the year is compared with; tbillEntered: the one the
  // user set, if any; tbillAuction: SBP's auction date when it is theirs.
  market: { kse: number | null; kmi: number | null; tbill: number | null; tbillRate: number | null; tbillFrom: TbillSource | null; tbillAuction: string | null; tbillEntered: number | null };
};

export type FyBoard = { years: YearRow[]; current: YearRow | null; firstTrade: string | null };

// The 12-month T-bill rate on each year's first day, as the user entered it
// on the Yearly tab (SBP's past auctions are not kept), by the year's end.
const tbillKey = async () => `fy:tbill:${(await getCurrentUserId()) ?? ""}`;

export async function getYearTbills(): Promise<Record<string, number>> {
  const snap = await getFeedSnapshot<Record<string, number>>(await tbillKey());
  return snap.data ?? {};
}

export async function saveYearTbill(endYear: number, pct: number | null): Promise<void> {
  const rates = { ...(await getYearTbills()) };
  if (pct == null) delete rates[String(endYear)];
  else rates[String(endYear)] = pct;
  await saveFeedSnapshot(await tbillKey(), rates, "ok", `${Object.keys(rates).length} years`);
}

async function _getFyProfits(): Promise<FyBoard> {
  const [txs, summary, funds, savings, fixedAll] = await Promise.all([getAllTransactions(), getPortfolioSummary(), getMutualFundsValued().catch(() => []), getSavingsValued().catch(() => []), getFixedIncomeValued().catch(() => [])]);
  // Every share counts, parked ones too: the sales that left a few shares
  // parked made or lost money in their year, and the Holding tab's totals
  // keep those gains, losses and dividends as well.
  const mine: FyTx[] = txs
    .map((t: any) => ({ symbol: t.symbol, type: t.type, date: new Date(t.date).toISOString().slice(0, 10), shares: Number(t.shares) || 0, netAmount: Number(t.netAmount) || 0, totalAmount: Number(t.totalAmount) || 0, taxDeducted: Number(t.taxDeducted) || 0, ratio: t.ratio ?? "" }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // The rest of the book as the total return counts it: T-bills and deposits
  // still held, savings, and every fund with its redemptions.
  const fixed = fixedAll.filter((f) => !f.matured);
  const otherDates = [...funds.flatMap((f) => f.trades.map((x) => x.date)), ...savings.map((a) => a.anchorDate), ...fixed.map((f) => f.purchaseDate)].filter(Boolean).sort();
  if (mine.length === 0 && otherDates.length === 0) return { years: [], current: null, firstTrade: null };

  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); // Karachi
  const firstDate = [mine[0]?.date, otherDates[0]].filter(Boolean).sort()[0] as string;
  const first = fyOf(firstDate), last = fyOf(today);

  // Gains and losses on what was sold, by the year of the sale.
  const realizedBy = new Map<number, number>();
  const bySym = new Map<string, any[]>();
  for (const t of txs) (bySym.get(t.symbol) ?? bySym.set(t.symbol, []).get(t.symbol)!).push(t);
  for (const [s, list] of bySym) for (const d of buildLots(s, list).disposals) realizedBy.set(fyOf(d.soldDate), (realizedBy.get(fyOf(d.soldDate)) ?? 0) + d.gain);

  // Prices: each year's end close, and today's for the year not over.
  const live = new Map([...summary.positions, ...summary.parked].filter((p) => p.priceKnown && p.currentPrice > 0).map((p) => [p.symbol, p.currentPrice]));
  const lastClose = await latestCloses().catch(() => new Map<string, { date: string; close: number }>());
  const yearEnd = new Map<number, Map<string, number>>();
  for (let y = first - 1; y <= last; y++) if (y < last || `${y}-06-30` < today) yearEnd.set(y, await closesOn(`${y}-06-30`));

  const windows = Array.from({ length: last - first + 1 }, (_, k) => fyWindow(first + k, today));
  const uid = (await getCurrentUserId()) ?? "";
  const [bars, rateSteps, tbills, taxYears, july, auctions] = await Promise.all([
    loadStoredBars(["KSE100", "KMI30"]).catch(() => new Map()),
    getSbpRateSteps().then((r) => r.steps).catch(() => []),
    getYearTbills().catch(() => ({} as Record<string, number>)),
    getTaxYears().catch(() => []),
    (RateSnapshotModel.find({ userId: uid, month: { $in: windows.map((w) => `${w.endYear - 1}-07`) }, tbill12mPct: { $ne: null } }, { month: 1, tbill12mPct: 1 }).lean() as Promise<any[]>).catch(() => []),
    getTbillAuctions().catch(() => []),
  ]);
  const julyOf = new Map(july.map((r) => [Number(String(r.month).slice(0, 4)) + 1, Number(r.tbill12mPct)]));
  const series = (code: string) => ((bars.get(code) ?? []) as Array<{ date: string; close: number }>).filter((b) => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const kse = series("KSE100"), kmi = series("KMI30");
  const cgtBy = new Map(taxYears.map((r) => [r.endYear, r.cgt]));
  const other = otherByYear(
    {
      funds: funds.map((f) => ({ trades: f.trades, openGain: f.units > 0 ? f.value - f.cost : 0 })),
      savings: savings.map((a) => ({ ratePercent: a.ratePercent, anchorDate: a.anchorDate, anchorBalance: a.anchorBalance, movements: a.movements })),
      fixed: fixed.map((f) => ({ kind: f.kind, name: f.name, face: f.face, cost: f.cost, purchaseDate: f.purchaseDate, maturityDate: f.maturityDate, couponPct: f.couponPct, couponsPerYear: f.couponsPerYear, taxPct: f.taxPct, pricePct: f.pricePct })),
    },
    windows,
    today
  );

  const years: YearRow[] = windows.map((w) => {
    const y = w.endYear;
    const startCloses = yearEnd.get(y - 1) ?? new Map<string, number>();
    const endCloses = w.current ? null : yearEnd.get(y) ?? new Map<string, number>();
    const shares = fyProfit(
      mine,
      w,
      {
        start: (s) => startCloses.get(s) ?? null,
        end: (s) => (endCloses ? endCloses.get(s) ?? null : live.get(s) ?? lastClose.get(s)?.close ?? null),
      },
      realizedBy.get(y) ?? 0
    );
    const o = other.get(y) ?? { funds: 0, savings: 0, fixed: 0 };
    const tb = tbillFor(y, tbills, auctions, julyOf.get(y) ?? null);
    const own = tbills[String(y)];
    return {
      ...shares,
      other: o,
      total: shares.profit + o.funds + o.savings + o.fixed,
      cgt: cgtBy.get(y) ?? null,
      market: {
        kse: indexChangePct(kse, w),
        kmi: indexChangePct(kmi, w),
        tbill: tb ? tbillPct(tb.rate, w) : rateSteps.length > 0 ? policyPct(rateSteps, w) : null,
        tbillRate: tb?.rate ?? null,
        tbillFrom: tb ? tb.from : rateSteps.length > 0 ? "policy" : null,
        tbillAuction: tb?.auction ?? null,
        tbillEntered: own != null && Number.isFinite(own) ? own : null,
      },
    };
  });
  years.reverse();
  return { years, current: years.find((y) => y.fy.current) ?? null, firstTrade: mine[0]?.date ?? firstDate };
}

export const getFyProfits = cache(_getFyProfits);
