import { notFound } from "next/navigation";
import { FyProfitTable } from "@/components/dashboard/FyProfitTable";
import { YearlyShares } from "@/components/dashboard/YearlyShares";
import { fyProfit, fyWindow, type FyTx } from "@/lib/analytics/fy-profit";
import { moneyAtWork } from "@/lib/calculations";
import type { Transaction } from "@/lib/types";

// The Yearly tab on sample trades, for looking at the design on a machine
// with no database. Development only.
export const dynamic = "force-dynamic";

const t = (symbol: string, type: FyTx["type"], date: string, shares: number, px: number): FyTx => ({ symbol, type, date, shares: type === "SELL" ? -shares : shares, netAmount: type === "DIVIDEND" ? px : Math.abs(shares) * px, taxDeducted: type === "DIVIDEND" ? px * 0.15 : 0 });
const TXS: FyTx[] = [
  t("NBP", "BUY", "2025-06-20", 300, 107),
  t("NBP", "DIVIDEND", "2025-09-05", 0, 32487),
  t("NBP", "SELL", "2026-02-11", 300, 160),
  t("MEBL", "BUY", "2025-08-12", 545, 290),
  t("MEBL", "DIVIDEND", "2026-03-02", 0, 2869),
  t("MEBL", "BUY", "2026-08-05", 244, 480),
  t("PTL", "BUY", "2025-10-01", 1859, 38),
  t("PTL", "DIVIDEND", "2026-03-25", 0, 2700),
  t("PTL", "BUY", "2026-07-20", 1389, 62),
  t("PTL", "SELL", "2026-10-13", 3000, 48),
  t("MUREB", "BUY", "2026-01-15", 165, 990),
  t("MUREB", "BUY", "2026-07-08", 497, 940),
  t("HINOON", "BUY", "2026-08-20", 479, 1100),
  t("LUCK", "BUY", "2026-01-10", 60, 1300),
  t("LUCK", "SELL", "2026-08-01", 54, 980),
];
const CLOSES: Record<string, Record<string, number>> = {
  "2025-06-30": { NBP: 108.2 },
  "2026-06-30": { MEBL: 516.46, PTL: 58.34, MUREB: 919.55, LUCK: 1100 },
};
const NOW: Record<string, number> = { MEBL: 560, PTL: 49.1, MUREB: 936, HINOON: 1050, LUCK: 950 };

export default async function YearlyPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const today = "2026-10-14";
  const years = [2025, 2026, 2027].map((y) => {
    const w = fyWindow(y, today);
    const start = CLOSES[`${y - 1}-06-30`] ?? {};
    const end = w.current ? NOW : CLOSES[`${y}-06-30`] ?? {};
    return fyProfit(TXS, w, { start: (s) => start[s] ?? null, end: (s) => end[s] ?? null }, 0);
  }).reverse();
  const board = { years, current: years.find((y) => y.fy.current) ?? null, firstTrade: TXS[0].date };
  const asOf = new Date(today + "T12:00:00Z");
  const employed = Object.fromEntries([...new Set(TXS.map((x) => x.symbol))].map((s) => [s, moneyAtWork(TXS.filter((x) => x.symbol === s) as unknown as Transaction[], asOf).average]));
  return (
    <div className="p-4">
      <FyProfitTable board={board} />
      <YearlyShares board={board} employed={employed} parked={["LUCK"]} />
    </div>
  );
}
