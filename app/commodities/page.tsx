import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { CommoditiesView } from "./CommoditiesView";
import { getCommodityTradesValued, checkDataAvailability } from "@/lib/data";
import { fmtRs } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CommoditiesPage() {
  const avail = await checkDataAvailability();
  const { trades, settings } = await getCommodityTradesValued();

  const open = trades.filter((t) => t.isOpen);
  const closed = trades.filter((t) => !t.isOpen);
  const openPL = open.reduce((s, t) => s + t.netPL, 0);
  const realizedPL = closed.reduce((s, t) => s + t.netPL, 0);
  const totalCgt = closed.reduce((s, t) => s + t.cgt, 0);
  const totalCommission = trades.reduce((s, t) => s + t.commission, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Commodities · PMEX"
        title="Gold, silver, oil — your swing trades."
        subtitle="Track PMEX commodity & index futures. P/L, commission and CGT are computed from your trade prices (Settings hold your commission/lot and CGT rate). International reference prices come live from Yahoo; PMEX itself blocks bots, so mark open trades with your own current price."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Open positions" value={String(open.length)} />
        <Stat label="Open P/L (mark)" value={fmtRs(openPL)} tone={openPL >= 0 ? "positive" : "negative"} />
        <Stat label="Realised P/L" value={fmtRs(realizedPL)} tone={realizedPL >= 0 ? "positive" : "negative"} />
        <Stat label="CGT on closed" value={fmtRs(totalCgt)} tone="muted" />
        <Stat label="Commission paid" value={fmtRs(totalCommission)} tone="muted" />
        <Stat label="Comm./lot" value={fmtRs(settings.pmexCommissionPerLot)} tone="muted" />
      </StatRow>

      <Section
        number="01"
        title="Trades"
        display="Long or short, lot by lot."
        description="Add a trade with your entry. For open swings, set a current price to mark it; for closed ones, the exit crystallises P/L, commission and CGT."
      >
        <CommoditiesView trades={trades} commissionPerLot={settings.pmexCommissionPerLot} cgtPercent={settings.pmexCgtPercent} />
      </Section>
    </div>
  );
}
