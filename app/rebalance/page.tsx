import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { RebalanceView } from "./RebalanceView";
import { TargetsEditor } from "./TargetsEditor";
import { getPortfolioSummary, getAllHoldings, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RebalancePage() {
  const avail = await checkDataAvailability();
  const [summary, holdings] = await Promise.all([
    getPortfolioSummary(),
    getAllHoldings(),
  ]);

  const bandBySymbol = new Map<string, number>();
  for (const h of holdings) bandBySymbol.set(h.symbol, (h as any).rebalanceBand ?? 3);

  const targetRows = summary.positions.map((p) => ({
    symbol: p.symbol,
    sector: p.sector,
    currentPercent: p.currentPercent,
    targetPercent: p.targetPercent,
    rebalanceBand: bandBySymbol.get(p.symbol) ?? 3,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Rebalance"
        title="Where the money goes next."
        subtitle="Deploy fresh cash (or optionally rebalance by selling) against your target allocations."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      {targetRows.length > 0 && (
        <Section number="01" title="Target allocations">
          <TargetsEditor initial={targetRows} />
        </Section>
      )}

      <Section number={targetRows.length > 0 ? "02" : "01"} title="Rebalance">
        <RebalanceView positions={summary.positions} totalValue={summary.totalValue} />
      </Section>
    </div>
  );
}
