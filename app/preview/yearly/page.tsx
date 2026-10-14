import { notFound } from "next/navigation";
import { FyProfitTable } from "@/components/dashboard/FyProfitTable";
import { YearlyShares } from "@/components/dashboard/YearlyShares";
import { fyProfit, fyWindow, type FyTx } from "@/lib/analytics/fy-profit";
import { indexChangePct, otherByYear, policyPct, tbillPct } from "@/lib/analytics/fy-extra";
import type { YearRow } from "@/lib/analytics/fy";
import { moneyAtWork } from "@/lib/calculations";
import { SBP_POLICY_RATE_DEFAULTS } from "@/lib/timeseries/sbp-rate";
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
const KSE = [{ date: "2024-06-28", close: 78445 }, { date: "2025-06-30", close: 125627 }, { date: "2026-06-30", close: 158210 }, { date: "2026-10-13", close: 170512 }];
const KMI = [{ date: "2024-06-28", close: 125000 }, { date: "2025-06-30", close: 188000 }, { date: "2026-06-30", close: 231000 }, { date: "2026-10-13", close: 243201 }];

export default async function YearlyPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const today = "2026-10-14";
  const windows = [2025, 2026, 2027].map((y) => fyWindow(y, today));
  const other = otherByYear({ funds: [{ trades: [{ date: "2026-09-21", side: "REDEEM", realizedGain: 1898 }], openGain: 0 }], savings: [], fixed: [] }, windows, today);
  const years: YearRow[] = windows
    .map((w) => {
      const start = CLOSES[`${w.endYear - 1}-06-30`] ?? {};
      const end = w.current ? NOW : CLOSES[`${w.endYear}-06-30`] ?? {};
      const shares = fyProfit(TXS, w, { start: (s) => start[s] ?? null, end: (s) => end[s] ?? null }, 0);
      const o = other.get(w.endYear) ?? { funds: 0, savings: 0, fixed: 0 };
      const entered = w.endYear === 2026 ? 11 : null;
      return {
        ...shares,
        other: o,
        total: shares.profit + o.funds + o.savings + o.fixed,
        cgt: w.endYear === 2026 ? 3200 : w.endYear === 2027 ? 0 : null,
        market: { kse: indexChangePct(KSE, w), kmi: indexChangePct(KMI, w), tbill: entered != null ? tbillPct(entered, w) : policyPct(SBP_POLICY_RATE_DEFAULTS, w), tbillRate: entered, tbillFrom: entered != null ? ("sbp" as const) : ("policy" as const), tbillAuction: entered != null ? "2025-06-25" : null, tbillEntered: null },
      };
    })
    .reverse();
  const board = { years, current: years.find((y) => y.fy.current) ?? null, firstTrade: TXS[0].date };
  const asOf = new Date(today + "T12:00:00Z");
  const work = Object.fromEntries([...new Set(TXS.map((x) => x.symbol))].map((s) => {
    const w = moneyAtWork(TXS.filter((x) => x.symbol === s) as unknown as Transaction[], asOf);
    return [s, { average: w.average, days: w.daysHeld }];
  }));
  return (
    <div className="p-4">
      <FyProfitTable board={board} />
      <YearlyShares board={board} work={work} parked={["LUCK"]} />
    </div>
  );
}
