import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { RebalanceView } from "./RebalanceView";
import { TargetsEditor } from "./TargetsEditor";
import { AddCompany } from "./AddCompany";
import { DeploymentPlan } from "./DeploymentPlan";
import { getPortfolioSummary, getAllHoldings, getCashSummary, getDeploymentPlan, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RebalancePage() {
  const avail = await checkDataAvailability();
  const [summary, holdings, cashSummary, plan] = await Promise.all([
    getPortfolioSummary(),
    getAllHoldings(),
    getCashSummary(),
    getDeploymentPlan(),
  ]);

  const bandBySymbol = new Map<string, number>();
  for (const h of holdings) bandBySymbol.set(h.symbol, (h as any).rebalanceBand ?? 3);

  // Show positions you actually own OR have a target % set for. Hide ghosts
  // (0 shares + 0 target) — typically dividend-only history.
  const relevant = summary.positions.filter(
    (p) => p.shares > 0 || (p.targetPercent ?? 0) > 0
  );

  const targetRows = relevant.map((p) => ({
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

      <Section number="01" title="Plan & targets" description="Add a company you intend to buy, then set target weights for everything.">
        <div className="space-y-6">
          <AddCompany />
          {targetRows.length > 0 && <TargetsEditor initial={targetRows} />}
        </div>
      </Section>

      <Section
        number="02"
        title="Buy zones & your cash"
        display="What to buy today, and what stays in the fund."
        description={`Your watchlist bands, checked against live prices, sized against your target weights, and paid for out of the money-market fund — with ${plan.reservePct}% of total wealth always left behind as the reserve. Nothing here places an order.`}
        action={
          <Link href="/watchlist" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
            Edit zones →
          </Link>
        }
      >
        <DeploymentPlan plan={plan} />
      </Section>

      <Section
        number="03"
        title="Rebalance"
        display="Deploy cash. Buy integers."
        description={`Cash available in your brokerage balance: ${cashSummary.balance >= 0 ? "Rs " + cashSummary.balance.toLocaleString("en-PK", { maximumFractionDigits: 0 }) : "negative — you need to record a deposit"}. Share counts are integers, so the leftover rupees never get spent and stay as cash.`}
      >
        <RebalanceView
          positions={relevant}
          totalValue={summary.totalValue}
          availableCashBalance={cashSummary.balance}
        />
      </Section>
    </div>
  );
}
