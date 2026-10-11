import "server-only";
import { getAllTransactions, getDividendForecast, getAppSettings, getFixedIncomeValued, getSavingsValued, getMutualFundsValued } from "@/lib/data";
import { getAnnouncedActions } from "@/lib/corporate-actions";
import { incomeCalendar, type IncomeCalendar } from "@/lib/calculations/income-calendar";
import { fixedIncomeEvents } from "@/lib/fixed-income/value";
import { whtPct } from "@/lib/calculations/pk-tax";

// This financial year's income month by month, after tax
// (lib/calculations/income-calendar.ts): dividends recorded, announced and
// expected; T-bill and sukuk profit; savings and money market funds.
export async function getIncomeCalendar(): Promise<IncomeCalendar> {
  const [txs, forecast, announced, settings, fixed, savings, funds] = await Promise.all([
    getAllTransactions(),
    getDividendForecast().catch(() => null),
    getAnnouncedActions().catch(() => ({ upcoming: [], recorded: [] })),
    getAppSettings(),
    getFixedIncomeValued().catch(() => []),
    getSavingsValued().catch(() => []),
    getMutualFundsValued().catch(() => []),
  ]);
  const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  const divTax = whtPct("dividend", settings as any);
  const podTax = whtPct("profit-on-debt", settings as any);
  return incomeCalendar({
    today: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10),
    dividends: txs.filter((t) => t.type === "DIVIDEND").map((t) => ({ date: iso(t.date), net: t.netAmount })),
    announced: announced.upcoming.filter((a) => a.type === "DIVIDEND" && a.status === "upcoming").map((a) => ({ date: a.bookClosure, net: a.net })),
    forecast: (forecast?.due ?? []).map((e) => ({ date: iso(e.date), gross: e.expectedGross })),
    dividendTaxPct: divTax,
    fixed: fixed.flatMap((f) => fixedIncomeEvents(f).map((e) => ({ date: e.date, net: e.gross - e.tax }))),
    cash: [
      ...savings.filter((a) => a.balance > 0).map((a) => ({ value: a.balance, ratePct: a.ratePercent, taxPct: podTax })),
      ...funds.filter((f) => f.moneyMarket && f.value > 0).map((f) => ({ value: f.value, ratePct: f.liveAnnualYieldPct ?? f.annualYieldPct ?? 0, taxPct: divTax })),
    ],
  });
}
