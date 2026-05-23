import { PageHeader } from "@/components/layout/PageHeader";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { RebalanceView } from "./RebalanceView";
import { getPortfolioSummary, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RebalancePage() {
  const avail = await checkDataAvailability();
  const summary = await getPortfolioSummary();
  return (
    <div>
      <PageHeader
        eyebrow="Rebalance"
        title="Where the money goes next."
        subtitle="Deploy fresh cash (or optionally rebalance by selling) against your target allocations."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <RebalanceView positions={summary.positions} totalValue={summary.totalValue} />
    </div>
  );
}
