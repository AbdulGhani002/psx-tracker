import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { CompareClient } from "./CompareClient";

export const dynamic = "force-dynamic";

export default function ComparePage() {
  return (
    <div className="fade-in">
      <PageHeader eyebrow="Market · Compare" title="Compare up to five stocks." subtitle="Put any PSX names side by side — valuation, growth, quality, momentum and the AI score." />
      <Section number="01" title="Side by side" description="Type symbols (e.g. MEBL, HUBC, LUCK) and compare.">
        <CompareClient />
      </Section>
    </div>
  );
}
