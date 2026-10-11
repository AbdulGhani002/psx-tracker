import { notFound } from "next/navigation";
import { StrategyView } from "@/app/strategy/StrategyView";
import { strategyPlan, type Rates, type StrategyInput } from "@/lib/strategy/plan";
import { FixedIncomeManager } from "@/app/funds/FixedIncomeManager";
import { Card } from "@/components/ui/Card";
import { valueFixedIncome, tbillCost, type FixedIncomeHolding } from "@/lib/fixed-income/value";

// The strategy page on sample figures, for looking at the design on a
// machine with no database. Development only.
export const dynamic = "force-dynamic";

export default async function StrategyPreview({ searchParams }: { searchParams: Promise<{ full?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const rates: Rates = { month: "2026-10", policyPct: 11.5, tbill3mPct: 11.6, tbill6mPct: 11.9, tbill12mPct: 11.99, sukukPct: 11.8, savingsPct: 10, moneyMarketPct: 10.6, inflationPct: 11.15, taxPct: 15 };
  const input: StrategyInput = {
    today: "2026-10-11",
    profile: { risk: "balanced", horizon: "long" },
    kse: { level: 156_400, high: 198_500, highDate: "2026-06-24", ma200: 171_000 },
    market: { pe: 8.4, cape: 7.4, dividendYieldPct: 6.2 },
    rates,
    prevRates: { ...rates, month: "2026-09", policyPct: 12 },
    // ?full=1: everything in stocks, no cash recorded.
    book: (await searchParams).full === "1" ? { stocks: 2_065_000, equityFunds: 0, cashLike: 0, fixedIncome: 0 } : { stocks: 1_980_000, equityFunds: 0, cashLike: 650_000, fixedIncome: 500_000 },
    names: [
      { symbol: "MEBL", held: true, value: 450_000, grade: "A", quadrant: "premium", roeSpreadPp: 13.8, dividendYieldPct: 3.9, marginOfSafetyPct: 8 },
      { symbol: "HINOON", held: true, value: 500_000, grade: "A", quadrant: "premium", roeSpreadPp: 16.8, dividendYieldPct: 5.4, marginOfSafetyPct: 24 },
      { symbol: "PTL", held: true, value: 180_000, grade: "C", quadrant: "danger", roeSpreadPp: -3.1, dividendYieldPct: 8.2 },
      { symbol: "MARI", held: false, value: 0, grade: "B", quadrant: "compounder", roeSpreadPp: 12.9, dividendYieldPct: 12.5 },
      { symbol: "INDU", held: false, value: 0, grade: "A", quadrant: "compounder", roeSpreadPp: 12.4, dividendYieldPct: 9.1 },
      { symbol: "FABL", held: false, value: 0, grade: "B", quadrant: "compounder", roeSpreadPp: 1.9, dividendYieldPct: 13.2 },
    ],
  };
  const plan = strategyPlan(input);
  const s = { plan, rates, ratesEntered: true, profile: input.profile, kse: { ...input.kse!, asOf: "2026-10-10" }, book: input.book, history: [rates, { ...rates, month: "2026-09", policyPct: 12, tbill12mPct: 12.4 }] };
  const holdings: FixedIncomeHolding[] = [
    { kind: "tbill", name: "12M T-bill", face: 300_000, cost: tbillCost(300_000, 11.99, 365), purchaseDate: "2026-07-03", maturityDate: "2027-07-03", couponPct: 0, couponsPerYear: 0, taxPct: 15 },
    { kind: "tbill", name: "3M T-bill", face: 100_000, cost: tbillCost(100_000, 11.6, 91), purchaseDate: "2026-08-14", maturityDate: "2026-11-13", couponPct: 0, couponsPerYear: 0, taxPct: 15 },
    { kind: "sukuk", name: "GoP Ijara Sukuk 5Y", face: 100_000, cost: 99_200, purchaseDate: "2026-02-10", maturityDate: "2031-01-29", couponPct: 11.8, couponsPerYear: 2, taxPct: 15, pricePct: 100.4 },
  ];
  const rows = holdings.map((h, k) => ({ _id: String(k), ...h, pricePct: h.pricePct ?? null, notes: "", ...valueFixedIncome(h, "2026-10-11") }));
  return (
    <div>
      <StrategyView s={s} prefill={{ values: rates, sources: { policyPct: "SBP, 2026-09-11", inflationPct: "PBS CPI, 2026-08" }, entered: true }} />
      <Card className="mt-3" title="T-bills and sukuks" eyebrow="As on the Cash tab">
        <FixedIncomeManager rows={rows as any} taxPct={15} />
      </Card>
    </div>
  );
}
