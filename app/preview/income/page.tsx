import { notFound } from "next/navigation";
import { IncomeCalendar } from "@/components/dashboard/IncomeCalendar";
import { TaxByYear, FixedIncomeTax } from "@/components/tax/TaxTables";
import { incomeCalendar } from "@/lib/calculations/income-calendar";
import { fixedIncomeEvents, tbillCost, type FixedIncomeHolding } from "@/lib/fixed-income/value";

// The income calendar and the tax tables on sample figures, for looking at
// the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

export default async function IncomePreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const today = "2026-10-11";
  const holdings: FixedIncomeHolding[] = [
    { kind: "tbill", name: "3M T-bill", face: 100_000, cost: tbillCost(100_000, 11.6, 91), purchaseDate: "2026-08-14", maturityDate: "2026-11-13", couponPct: 0, couponsPerYear: 0, taxPct: 15 },
    { kind: "tbill", name: "6M T-bill", face: 200_000, cost: tbillCost(200_000, 11.9, 182), purchaseDate: "2026-04-02", maturityDate: "2026-10-01", couponPct: 0, couponsPerYear: 0, taxPct: 15 },
    { kind: "sukuk", name: "GoP Ijara Sukuk 5Y", face: 100_000, cost: 99_200, purchaseDate: "2026-02-10", maturityDate: "2031-01-29", couponPct: 11.8, couponsPerYear: 2, taxPct: 15 },
  ];
  const events = holdings.flatMap((h) => fixedIncomeEvents(h).map((e) => ({ name: h.name, kind: h.kind, ...e, paid: e.date <= today })));
  const cal = incomeCalendar({
    today,
    dividends: [
      { date: "2026-08-21", net: 6_120 },
      { date: "2026-09-02", net: 2_550 },
      { date: "2026-09-25", net: 11_900 },
    ],
    announced: [{ date: "2026-10-20", net: 4_250 }],
    forecast: [
      { date: "2026-11-05", gross: 3_000 },
      { date: "2027-02-18", gross: 7_200 },
      { date: "2027-03-10", gross: 14_000 },
      { date: "2027-04-22", gross: 3_000 },
    ],
    dividendTaxPct: 15,
    fixed: events.map((e) => ({ date: e.date, net: e.gross - e.tax })),
    cash: [{ value: 400_000, ratePct: 10, taxPct: 15 }],
  });
  const inYear = events.filter((e) => e.date >= "2026-07-01" && e.date <= "2027-06-30").sort((a, b) => a.date.localeCompare(b.date));
  const paid = inYear.filter((e) => e.paid).reduce((s, e) => s + e.tax, 0);
  const years = [
    { endYear: 2027, label: "FY26-27", current: true, cgt: 0, dividendTax: 3_620, fixedTax: paid, total: 3_620 + paid },
    { endYear: 2026, label: "FY25-26", current: false, cgt: 4_210, dividendTax: 18_340, fixedTax: 0, total: 22_550 },
    { endYear: 2025, label: "FY24-25", current: false, cgt: 0, dividendTax: 160, fixedTax: 0, total: 160 },
  ];
  return (
    <div>
      <IncomeCalendar cal={cal} />
      <div className="mt-3">
        <TaxByYear years={years} selected={2027} />
      </div>
      <FixedIncomeTax rows={inYear} />
    </div>
  );
}
