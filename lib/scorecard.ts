import "server-only";
import { getAllTransactions } from "@/lib/data";
import { buildLots } from "@/lib/calculations/lots";
import { salesFrom, scoreOf, type SaleResult, type Score } from "@/lib/calculations/scorecard";
import { currentTaxYear } from "@/lib/dates";

// The trading scorecard (lib/calculations/scorecard) for this month, last
// month, this tax year and all time, from every trade on the ledger.

const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const monthBefore = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function ledger(): Promise<{ sales: SaleResult[]; feesIn: (from: string, to: string) => number }> {
  const txs = (await getAllTransactions()) as any[];
  const bySymbol = new Map<string, any[]>();
  for (const t of txs) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  const disposals = [...bySymbol].flatMap(([sym, list]) => buildLots(sym, list).disposals);
  const trades = txs.filter((t) => t.type === "BUY" || t.type === "SELL").map((t) => ({ date: iso(t.date), fees: Number(t.fees) || 0 }));
  return { sales: salesFrom(disposals), feesIn: (from, to) => trades.filter((t) => t.date >= from && t.date <= to).reduce((s, t) => s + t.fees, 0) };
}

export async function getScorecard(): Promise<Array<{ label: string; score: Score }>> {
  const { sales, feesIn } = await ledger();
  const today = pkToday();
  const thisMonth = today.slice(0, 7), lastMonth = monthBefore(thisMonth);
  const ty = currentTaxYear();
  const periods = [
    { label: "This month", from: `${thisMonth}-01`, to: today },
    { label: monthLabel(lastMonth), from: `${lastMonth}-01`, to: `${lastMonth}-31` },
    { label: `Tax year ${ty.label}`, from: `${ty.startYear}-07-01`, to: today },
    { label: "All time", from: "0000-01-01", to: today },
  ];
  return periods.map((p) => ({ label: p.label, score: scoreOf(sales.filter((s) => s.date >= p.from && s.date <= p.to), feesIn(p.from, p.to)) }));
}

// One month (yyyy-mm), for its Telegram line.
export async function monthScore(month: string): Promise<{ label: string; score: Score }> {
  const { sales, feesIn } = await ledger();
  return { label: monthLabel(month), score: scoreOf(sales.filter((s) => s.date.startsWith(month)), feesIn(`${month}-01`, `${month}-31`)) };
}
