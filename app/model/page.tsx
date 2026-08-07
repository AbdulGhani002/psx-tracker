import { PageHeader } from "@/components/layout/PageHeader";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { ModelView } from "./ModelView";
import { getPortfolioSummary, getEffectiveInflationPct, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ModelPage() {
  const inf = await getEffectiveInflationPct();
  const avail = await checkDataAvailability();
  const summary = await getPortfolioSummary();

  return (
    <div>
      <PageHeader
        eyebrow="Forward projection"
        title="What this could be."
        subtitle="Compound your positions under multiple growth, multiple-expansion, and payout scenarios. Pick a single stock or model the whole portfolio."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <ModelView inflationPct={inf.pct} positions={summary.positions} totalValue={summary.totalValue} totalCost={summary.totalCost} />
    </div>
  );
}
