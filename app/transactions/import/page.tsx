import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { ImportView } from "./ImportView";
import { NotePdfCard } from "./NotePdfCard";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div>
      <div className="mb-6">
        <Link href="/transactions" className="label-cap hover:text-[var(--accent-deep)]">← Transactions</Link>
      </div>
      <PageHeader
        eyebrow="Import"
        title="Bring in your history at once."
        subtitle="Drop broker contract-note PDFs straight in — every note is reconciled against its own totals before anything imports. Or paste a CSV (symbol, type, date, shares, price, fees, notes). Preview first, then import — holdings and cost basis recompute automatically."
      />
      <Section number="01" title="Contract-note PDF" display="The note checks itself before it imports.">
        <NotePdfCard />
      </Section>
      <Section number="02" title="CSV import" display="Map once, import everything.">
        <ImportView />
      </Section>
    </div>
  );
}
