import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { ImportView } from "./ImportView";

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
        subtitle="Paste or upload a CSV of transactions. Columns are auto-detected (symbol, type, date, shares, price, fees, notes). Preview first, then import — holdings and cost basis recompute automatically."
      />
      <Section number="01" title="CSV import" display="Map once, import everything.">
        <ImportView />
      </Section>
    </div>
  );
}
