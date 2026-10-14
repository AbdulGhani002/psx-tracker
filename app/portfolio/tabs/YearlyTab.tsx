import { Card } from "@/components/ui/Card";
import { FyProfitTable } from "@/components/dashboard/FyProfitTable";
import { YearlyShares } from "@/components/dashboard/YearlyShares";
import { getAllTransactions, getPortfolioSummary } from "@/lib/data";
import { getFyProfits } from "@/lib/analytics/fy";
import { moneyAtWork } from "@/lib/calculations";

// Profit by financial year: each year's whole book against the market, then
// each share's year by year with its yield on cost.

export async function YearlyTab() {
  const [board, txs, summary] = await Promise.all([getFyProfits(), getAllTransactions(), getPortfolioSummary()]);
  if (board.years.length === 0) return <Card><p className="text-[13px] text-muted">No trades yet.</p></Card>;
  const symbols = new Set(board.years.flatMap((y) => y.stocks.map((s) => s.symbol)));
  const work = Object.fromEntries(
    [...symbols].map((s) => {
      const w = moneyAtWork(txs.filter((t) => t.symbol === s));
      return [s, { average: w.average, days: w.daysHeld }];
    })
  );
  return (
    <div>
      <FyProfitTable board={board} />
      <YearlyShares board={board} work={work} parked={summary.parked.map((p) => p.symbol)} />
    </div>
  );
}
