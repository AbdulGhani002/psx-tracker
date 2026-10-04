import "server-only";
import { cache } from "react";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models";
import { getAllTransactions, getPortfolioSummary } from "@/lib/data";
import { buildLots } from "@/lib/calculations/lots";
import { latestCloses, SHEET_PREFIX } from "@/lib/quant/sheet-bars";
import { fyOf, fyWindow, fyProfit, type FyTx, type FyProfit } from "./fy-profit";

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

export type FyBoard = { years: FyProfit[]; current: FyProfit | null; firstTrade: string | null };

async function _getFyProfits(): Promise<FyBoard> {
  const [txs, summary] = await Promise.all([getAllTransactions(), getPortfolioSummary()]);
  // Parked holdings stay outside every total, as on the Holding tab.
  const parked = new Set(summary.parked.map((p) => p.symbol));
  const mine: FyTx[] = txs
    .filter((t) => !parked.has(t.symbol))
    .map((t: any) => ({ symbol: t.symbol, type: t.type, date: new Date(t.date).toISOString().slice(0, 10), shares: Number(t.shares) || 0, netAmount: Number(t.netAmount) || 0, totalAmount: Number(t.totalAmount) || 0, taxDeducted: Number(t.taxDeducted) || 0, ratio: t.ratio ?? "" }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (mine.length === 0) return { years: [], current: null, firstTrade: null };

  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); // Karachi
  const first = fyOf(mine[0].date), last = fyOf(today);

  // Gains and losses on what was sold, by the year of the sale.
  const realizedBy = new Map<number, number>();
  const bySym = new Map<string, any[]>();
  for (const t of txs) if (!parked.has(t.symbol)) (bySym.get(t.symbol) ?? bySym.set(t.symbol, []).get(t.symbol)!).push(t);
  for (const [s, list] of bySym) for (const d of buildLots(s, list).disposals) realizedBy.set(fyOf(d.soldDate), (realizedBy.get(fyOf(d.soldDate)) ?? 0) + d.gain);

  // Prices: each year's end close, and today's for the year not over.
  const live = new Map(summary.positions.filter((p) => p.priceKnown && p.currentPrice > 0).map((p) => [p.symbol, p.currentPrice]));
  const lastClose = await latestCloses().catch(() => new Map<string, { date: string; close: number }>());
  const yearEnd = new Map<number, Map<string, number>>();
  for (let y = first - 1; y <= last; y++) if (y < last || `${y}-06-30` < today) yearEnd.set(y, await closesOn(`${y}-06-30`));

  const years: FyProfit[] = [];
  for (let y = first; y <= last; y++) {
    const w = fyWindow(y, today);
    const startCloses = yearEnd.get(y - 1) ?? new Map<string, number>();
    const endCloses = w.current ? null : yearEnd.get(y) ?? new Map<string, number>();
    years.push(
      fyProfit(
        mine,
        w,
        {
          start: (s) => startCloses.get(s) ?? null,
          end: (s) => (endCloses ? endCloses.get(s) ?? null : live.get(s) ?? lastClose.get(s)?.close ?? null),
        },
        realizedBy.get(y) ?? 0
      )
    );
  }
  return { years: years.reverse(), current: years.find((y) => y.fy.current) ?? null, firstTrade: mine[0].date };
}

export const getFyProfits = cache(_getFyProfits);
