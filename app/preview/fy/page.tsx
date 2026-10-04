import { notFound } from "next/navigation";
import { FyProfitTable } from "@/components/dashboard/FyProfitTable";
import { fyProfit, fyWindow, type FyTx } from "@/lib/analytics/fy-profit";

// Profit by financial year on sample trades, for looking at the design on a
// machine with no database. Development only.
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
  t("PTL", "BUY", "2026-07-20", 1389, 62),
  t("MUREB", "BUY", "2026-01-15", 165, 990),
  t("MUREB", "BUY", "2026-07-08", 497, 940),
  t("HINOON", "BUY", "2026-08-20", 479, 1100),
];
const CLOSES: Record<string, Record<string, number>> = {
  "2025-06-30": { NBP: 108.2 },
  "2026-06-30": { MEBL: 516.46, PTL: 58.34, MUREB: 919.55 },
};
const NOW: Record<string, number> = { MEBL: 560, PTL: 55.1, MUREB: 936, HINOON: 1050 };

export default async function FyPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const today = "2026-10-04";
  const years = [2025, 2026, 2027].map((y) => {
    const w = fyWindow(y, today);
    const start = CLOSES[`${y - 1}-06-30`] ?? {};
    const end = w.current ? NOW : CLOSES[`${y}-06-30`] ?? {};
    return fyProfit(TXS, w, { start: (s) => start[s] ?? null, end: (s) => end[s] ?? null }, 0);
  });
  return <FyProfitTable board={{ years: years.reverse(), current: years.find((y) => y.fy.current) ?? null, firstTrade: TXS[0].date }} />;
}
