import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { ScreenerClient } from "./ScreenerClient";

export const dynamic = "force-dynamic";

export default function ScreenerPage() {
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Screener"
        title="Find the stocks that fit your rules."
        subtitle="Filter the whole PSX by valuation, momentum, quality and the AI score. Change any filter and the list updates live."
      />
      <Section number="01" title="Smart screener" description="Leave a filter blank to ignore it. Results are ranked by AI score. P/B, ROE, ROA and Debt/Equity need a book value PSX doesn't publish, so those filters are omitted for now.">
        <ScreenerClient />
      </Section>
    </div>
  );
}
