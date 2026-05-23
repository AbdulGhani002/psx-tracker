import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";

export default function DashboardPlaceholder() {
  return (
    <div>
      <PageHeader
        title="Your portfolio."
        subtitle="As of — initialising."
      />
      <StatRow>
        <Stat label="Total Value" value="—" />
        <Stat label="Cost Basis" value="—" />
        <Stat label="Unrealised P/L" value="—" />
        <Stat label="Realised P/L" value="—" />
        <Stat label="XIRR" value="—" />
        <Stat label="Dividends YTD" value="—" />
      </StatRow>

      <Section number="01" title="Allocation snapshot">
        <p className="text-sm text-muted">Holdings will appear here once seeded.</p>
      </Section>

      <Section number="02" title="Sector concentration">
        <p className="text-sm text-muted">Sector exposure chart placeholder.</p>
      </Section>

      <Section number="03" title="Recent activity">
        <p className="text-sm text-muted">Last five transactions.</p>
      </Section>
    </div>
  );
}
