import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { RebalanceView } from "./RebalanceView";
import { TargetsEditor } from "./TargetsEditor";
import { AddCompany } from "./AddCompany";
import { DeploymentPlan } from "./DeploymentPlan";
import { StandInPanel } from "./StandInPanel";
import { getPortfolioSummary, getAllHoldings, getDeploymentPlan, getAppSettings, checkDataAvailability } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RebalancePage() {
  const avail = await checkDataAvailability();
  const [summary, holdings, plan, settings] = await Promise.all([
    getPortfolioSummary(),
    getAllHoldings(),
    getDeploymentPlan(),
    getAppSettings(),
  ]);

  const bandBySymbol = new Map<string, number>();
  for (const h of holdings) bandBySymbol.set(h.symbol, (h as any).rebalanceBand ?? 3);

  // Show positions you actually own OR have a target % set for. Hide ghosts
  // (0 shares + 0 target) — typically dividend-only history.
  const relevant = summary.positions.filter(
    (p) => p.shares > 0 || (p.targetPercent ?? 0) > 0
  );

  // Symbols still on your books with no shares and no target. The table above
  // hides them, so before this line they were invisible everywhere — and the
  // add form used to reject them as duplicates, which left them unreachable.
  const dormant = holdings
    .filter((h: any) => (h.currentShares ?? 0) <= 0 && (h.targetAllocationPercent ?? 0) <= 0)
    .map((h: any) => h.symbol)
    .sort();

  // CASH is a position. It is the money-market fund plus any brokerage balance,
  // and it competes with every share for the same book — so it belongs in the
  // same table, on the same denominator, with a target of its own. Weights are
  // therefore percentages of equities PLUS cash, which is the only base on
  // which "15% MEBL" and "20% cash" mean comparable things.
  const cashValue = plan.cashLike;
  const bookValue = summary.totalValue + cashValue;
  const scale = bookValue > 0 ? summary.totalValue / bookValue : 1;

  const targetRows = [
    ...relevant.map((p) => ({
      symbol: p.symbol,
      sector: p.sector,
      // currentPercent arrives as a share of the equity book; restate it as a
      // share of the whole book so the column and the target agree.
      currentPercent: p.currentPercent * scale,
      targetPercent: p.targetPercent,
      rebalanceBand: bandBySymbol.get(p.symbol) ?? 3,
      isCash: false,
    })),
    {
      symbol: "CASH",
      sector: plan.fundsLabel ? `Money market · ${plan.fundsLabel}` : "Money market",
      currentPercent: bookValue > 0 ? (cashValue / bookValue) * 100 : 0,
      targetPercent: (settings as any).mfCashReservePct ?? 5,
      rebalanceBand: 0,
      isCash: true,
    },
  ];

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
          {targetRows.length > 0 && (
            <TargetsEditor
              initial={targetRows}
              cashValue={cashValue}
              bookValue={bookValue}
              strictZones={!!(settings as any).strictBuyZones}
            />
          )}
          {dormant.length > 0 && (
            <p className="text-[12px] text-muted max-w-[80ch]">
              <span className="label-cap">Dormant · {dormant.length}</span>{" "}
              <span className="font-mono">{dormant.join(", ")}</span> are still on your books with no shares and no
              target, so they are left out of the table above and out of every weight on this page. Their transaction
              history is intact. Type one into the form above to bring it back into the plan, or ignore them.
            </p>
          )}
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
        <DeploymentPlan
          candidates={plan.candidates}
          equityValue={plan.equityValue}
          fundsValue={plan.fundsValue}
          brokerCash={plan.brokerCash}
          reservePct={plan.reservePct}
          concentrationCap={(settings as any).concentrationCap ?? 25}
          fundsLabel={plan.fundsLabel}
          sells={plan.board.sells.map((r) => ({
            symbol: r.symbol,
            price: r.price,
            sharesHeld: r.sharesHeld,
            minHoldingShares: r.minHoldingShares,
            sellableShares: r.sellableShares,
            sellZoneLow: r.sellZoneLow,
            sellZoneHigh: r.sellZoneHigh,
            sell: r.sell,
          }))}
          heldAtCore={plan.board.heldAtCore.map((r) => ({
            symbol: r.symbol,
            sharesHeld: r.sharesHeld,
            minHoldingShares: r.minHoldingShares,
          }))}
          zones={plan.board.rows.map((r) => ({ symbol: r.symbol, buyZoneLow: r.buyZoneLow, buyZoneHigh: r.buyZoneHigh }))}
          serverWarnings={plan.serverWarnings}
          watchedCount={plan.board.rows.length}
        />
      </Section>

      {plan.standIns.length > 0 && (
        <Section
          number="03"
          title="Stand-ins"
          display={plan.standIns.some((g) => g.swapReady) ? "Time to swap back." : "Holding the sector, not the cash."}
          description="A peer bought to keep a sector exposure while the name you actually want sits above its buy band. The pair shares one target weight, so neither leg is judged on its own — and when the primary comes into range, the reversal is spelled out with its arithmetic."
        >
          <StandInPanel rows={plan.standIns as any} />
        </Section>
      )}

      <Section
        number="04"
        title="Rebalance"
        display="Deploy cash. Buy integers."
        description="Enter the cash you actually have and it is deployed against your target weights. Share counts are integers, so the leftover rupees never get spent. The brokerage balance is not offered here: it is derived from an incomplete deposit ledger, so it is not a figure to spend against."
      >
        <RebalanceView
          positions={relevant}
          totalValue={bookValue}
          availableCashBalance={0}
        />
      </Section>
    </div>
  );
}
