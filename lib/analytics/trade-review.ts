import "server-only";
import { connectDb } from "@/lib/db";
import { FundamentalModel } from "@/lib/models";
import { getAllTransactions, getAppSettings } from "@/lib/data";
import { latestCloses, loadStoredBars, pktToday } from "@/lib/quant/sheet-bars";
import { closeOn, type Close } from "./fy-extra";
import { reviewSale, type Payout, type SaleReview } from "./sale-review";
import { dueNotes, isReason, noteMessage, type NoteTrade } from "@/lib/notes/reminders";

// Looking back at trades: each sale against what its shares would be worth
// today (the Trades tab), and the reasons typed on buys and sales with what
// the price has done since (the holding page, and Telegram at three months
// and a year).

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

async function pricesFor(symbols: string[]) {
  const [bars, latest] = await Promise.all([loadStoredBars(symbols).catch(() => new Map()), latestCloses().catch(() => new Map<string, { date: string; close: number }>())]);
  const closes = (s: string): Close[] => ((bars.get(s) ?? []) as Close[]).filter((b) => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  return { closes, latest: (s: string) => latest.get(s) ?? null };
}

// The price since a day, bonus and split adjusted where the series has it.
function since(closes: Close[], latest: { date: string; close: number } | null, date: string, price: number): { price: number; changePct: number } | null {
  const then = closeOn(closes, date);
  const last = closes.length ? closes[closes.length - 1] : null;
  if (then != null && last != null && last.date > date) return { price: latest?.close ?? last.close, changePct: (last.close / then - 1) * 100 };
  if (latest && latest.date > date && price > 0) return { price: latest.close, changePct: (latest.close / price - 1) * 100 };
  return null;
}

export async function getSaleReviews(): Promise<SaleReview[]> {
  const [txs, settings] = await Promise.all([getAllTransactions(), getAppSettings()]);
  const sells = txs.filter((t) => t.type === "SELL" && Math.abs(t.shares) > 0);
  if (sells.length === 0) return [];
  const symbols = [...new Set(sells.map((t) => t.symbol))];
  await connectDb();
  const [p, funds] = await Promise.all([pricesFor(symbols), FundamentalModel.find({ symbol: { $in: symbols } }, { symbol: 1, faceValue: 1, payouts: 1 }).lean() as Promise<any[]>]);
  const payoutsOf = new Map<string, Payout[]>(
    funds.map((f) => [f.symbol, ((f.payouts ?? []) as any[]).filter((x) => (x.payoutType ?? "cash") === "cash" && x.bookClosure).map((x) => ({ bookClosure: String(x.bookClosure).slice(0, 10), dps: ((Number(x.pctOfFace) || 0) / 100) * (Number(f.faceValue) || 10) }))])
  );
  const tax = (settings as any).filerStatus === "non-filer" ? Number((settings as any).dividendWhtNonFiler ?? 30) : Number((settings as any).dividendWhtFiler ?? 15);
  return sells
    .map((t) => reviewSale({ id: String(t._id), symbol: t.symbol, date: day(t.date), shares: Math.abs(t.shares), price: t.pricePerShare, proceeds: t.netAmount }, p.closes(t.symbol), p.latest(t.symbol), payoutsOf.get(t.symbol) ?? [], tax))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type NoteReview = NoteTrade & { since: { price: number; changePct: number } | null };

const noteTrades = (txs: Awaited<ReturnType<typeof getAllTransactions>>, symbol?: string): NoteTrade[] =>
  txs
    .filter((t) => (t.type === "BUY" || t.type === "SELL") && (!symbol || t.symbol === symbol) && isReason(t.notes ?? ""))
    .map((t) => ({ id: String(t._id), symbol: t.symbol, type: t.type as "BUY" | "SELL", date: day(t.date), price: t.pricePerShare, note: String(t.notes) }));

export async function getNoteReviews(symbol: string): Promise<NoteReview[]> {
  const trades = noteTrades(await getAllTransactions(), symbol);
  if (trades.length === 0) return [];
  const p = await pricesFor([symbol]);
  return trades.map((t) => ({ ...t, since: since(p.closes(symbol), p.latest(symbol), t.date, t.price) })).sort((a, b) => b.date.localeCompare(a.date));
}

// Telegram: each reason three months and a year on.
export async function noteAlerts(): Promise<Array<{ key: string; message: string }>> {
  const due = dueNotes(noteTrades(await getAllTransactions()), pktToday());
  if (due.length === 0) return [];
  const p = await pricesFor([...new Set(due.map((d) => d.trade.symbol))]);
  return due.map((d) => ({ key: `trade-note:${d.trade.id}:${d.months}m`, message: noteMessage(d.trade, d.months, since(p.closes(d.trade.symbol), p.latest(d.trade.symbol), d.trade.date, d.trade.price)) }));
}
