import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { ShariahView } from "./ShariahView";
import { getShariahStatus, checkDataAvailability } from "@/lib/data";
import { fmtRs, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ShariahPage() {
  const avail = await checkDataAvailability();
  const s = await getShariahStatus();
  const total = s.totalValue || 1;

  return (
    <div>
      <PageHeader
        eyebrow="Shariah"
        title="Halal check & purification."
        subtitle="Each holding tagged by KMI index membership (Meezan-screened), with the charity (purification) due from your dividends. Index status updates as the KMI indices rebalance."
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="KMI-compliant" value={fmtRs(s.compliantValue)} tone="positive" hint={fmtPct(s.compliantValue / total, 0) + " of equities"} />
        <Stat label="Not in KMI" value={fmtRs(s.nonCompliantValue)} tone={s.nonCompliantValue > 0 ? "negative" : "muted"} hint={fmtPct(s.nonCompliantValue / total, 0)} />
        <Stat label="Unknown" value={fmtRs(s.unknownValue)} tone="muted" />
        <Stat label={`Purification due ${s.taxYearLabel}`} value={fmtRs(s.totalPurification)} tone="accent" hint="charity from dividends" />
      </StatRow>

      {s.holdings.length === 0 ? (
        <div className="mt-8"><Card><p className="text-sm text-muted">Add holdings to see their Shariah status.</p></Card></div>
      ) : (
        <Section
          number="01"
          title="Compliance & purification by holding"
          display="Halal status, stock by stock."
          description="Compliant = currently in the KMI-30 or KMI All-Share index (both Meezan-screened on debt, liquid assets and non-permissible income). Enter each company's non-permissible income % to get the exact charity due from the dividends you earned."
        >
          <ShariahView initial={s.holdings} />
        </Section>
      )}

      <p className="text-[11px] text-muted mt-6 max-w-[82ch]">
        Note: KMI index membership is a strong, live proxy for Shariah compliance, but the formal ruling for any stock is the
        screening done by your fund/scholar. Always confirm against AlMeezan/Meezan&apos;s own list before acting.
      </p>
    </div>
  );
}
