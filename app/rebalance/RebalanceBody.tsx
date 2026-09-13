import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { RebalanceView } from "./RebalanceView";
import { TargetsEditor } from "./TargetsEditor";
import { AddCompany } from "./AddCompany";
import { DeploymentPlan } from "./DeploymentPlan";
import { StandInPanel } from "./StandInPanel";
import { getPortfolioSummary, getAllHoldings, getDeploymentPlan, getAppSettings, checkDataAvailability } from "@/lib/data";
import { fmtRs } from "@/lib/format";

// Rebalancing, laid out the way Zar lays it out: the target allocation table
// beside its donut, the money free to deploy, then the trades that get the
// book to its targets. Used by the Rebalance page and the portfolio tab.
export async function RebalanceBody() {
  const avail = await checkDataAvailability();
  const [summary, holdings, plan, settings] = await Promise.all([getPortfolioSummary(), getAllHoldings(), getDeploymentPlan(), getAppSettings()]);

  const bandBySymbol = new Map<string, number>();
  for (const h of holdings) bandBySymbol.set(h.symbol, (h as any).rebalanceBand ?? 3);

  // Positions you own or have a target for. Ghosts (no shares, no target) are
  // dividend-only history and stay out of every weight on this page.
  const relevant = summary.positions.filter((p) => p.shares > 0 || (p.targetPercent ?? 0) > 0);
  const dormant = holdings
    .filter((h: any) => (h.currentShares ?? 0) <= 0 && (h.targetAllocationPercent ?? 0) <= 0)
    .map((h: any) => h.symbol)
    .sort();
  const targetRows = relevant.map((p) => ({ symbol: p.symbol, sector: p.sector, currentPercent: p.currentPercent, targetPercent: p.targetPercent, rebalanceBand: bandBySymbol.get(p.symbol) ?? 3 }));
  const targetTotal = relevant.reduce((s, p) => s + (p.targetPercent ?? 0), 0);
  const deployable = Math.max(0, plan.fundsValue + plan.brokerCash - ((plan.equityValue + plan.fundsValue + plan.brokerCash) * plan.reservePct) / 100);

  return (
    <div>
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Total portfolio value" value={fmtRs(plan.equityValue + plan.fundsValue + plan.brokerCash)} hint={`Equities ${fmtRs(plan.equityValue)}`} />
        <StatCard label="Target allocation total" value={`${targetTotal.toFixed(1)}%`} tone={Math.abs(targetTotal - 100) < 0.05 ? "positive" : "negative"} hint={Math.abs(targetTotal - 100) < 0.05 ? "Adds up to 100%" : "Targets should add up to 100%"} />
        <StatCard label="Deployable cash" value={fmtRs(deployable)} hint={`${plan.fundsLabel} and brokerage cash, less the ${plan.reservePct}% reserve`} />
        <StatCard label="Names in the plan" value={String(relevant.length)} hint={dormant.length > 0 ? `${dormant.length} dormant left out` : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2">
          <Card title="Define your target allocation" eyebrow="Adjust each target; the total must equal 100% to proceed" action={<AddCompany />}>
            {targetRows.length > 0 ? <TargetsEditor initial={targetRows} strictZones={!!(settings as any).strictBuyZones} /> : <div className="text-[12px] text-muted">Add a company above to start a plan.</div>}
            {dormant.length > 0 && (
              <p className="text-[12px] text-muted mt-3">
                Dormant ({dormant.length}): <span className="mono-num">{dormant.join(", ")}</span>. On your books with no shares and no target, so left out of every weight here. Add one above to bring it back.
              </p>
            )}
          </Card>
        </div>
        <Card title="Target allocation" eyebrow="What the book should look like">
          <AllocationDonut slices={relevant.filter((p) => (p.targetPercent ?? 0) > 0).map((p) => ({ label: p.symbol, value: p.targetPercent }))} maxSlices={10} centerValue={`${Math.round(targetTotal)}%`} centerLabel="assigned" />
        </Card>
      </div>

      <Card className="mt-3" title="Buy zones and your cash" eyebrow={`Your bands against live prices, sized to your targets and paid from the fund, with ${plan.reservePct}% of total wealth kept back`} action={<Link href="/watchlist" className="text-[12px] link-underline">Edit zones</Link>}>
        <DeploymentPlan
          candidates={plan.candidates}
          equityValue={plan.equityValue}
          fundsValue={plan.fundsValue}
          brokerCash={plan.brokerCash}
          reservePct={plan.reservePct}
          concentrationCap={(settings as any).concentrationCap ?? 25}
          fundsLabel={plan.fundsLabel}
          sells={plan.board.sells.map((r) => ({ symbol: r.symbol, price: r.price, sharesHeld: r.sharesHeld, minHoldingShares: r.minHoldingShares, sellableShares: r.sellableShares, sellZoneLow: r.sellZoneLow, sellZoneHigh: r.sellZoneHigh, sell: r.sell }))}
          heldAtCore={plan.board.heldAtCore.map((r) => ({ symbol: r.symbol, sharesHeld: r.sharesHeld, minHoldingShares: r.minHoldingShares }))}
          zones={plan.board.rows.map((r) => ({ symbol: r.symbol, buyZoneLow: r.buyZoneLow, buyZoneHigh: r.buyZoneHigh }))}
          serverWarnings={plan.serverWarnings}
          watchedCount={plan.board.rows.length}
        />
      </Card>

      {plan.standIns.length > 0 && (
        <Card className="mt-3" title="Stand-ins" eyebrow="A peer held for the sector while the name you want sits above its buy band">
          <StandInPanel rows={plan.standIns as any} />
        </Card>
      )}

      <Card className="mt-3" title="Rebalance your portfolio" eyebrow="Enter the cash you have and it is deployed against your targets in whole shares">
        <RebalanceView positions={relevant} totalValue={summary.totalValue} availableCashBalance={0} />
      </Card>
    </div>
  );
}
