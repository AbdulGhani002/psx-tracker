import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { BacktestClient } from "./BacktestClient";

export const dynamic = "force-dynamic";

export default function BacktestPage({ searchParams }: { searchParams: { symbol?: string } }) {
  const initial = (searchParams?.symbol || "MEBL").toUpperCase();
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Strategy"
        title="Would the rule have actually worked?"
        subtitle="Test a simple trading rule on any PSX stock's full price history, and judge it honestly against just buying and holding. Long-only, all-in / all-out, on daily closes."
      />
      <Section number="01" title="Backtester" description="Pick a stock and a rule. RSI buys oversold and sells overbought; SMA cross goes long when the fast average is above the slow; Above-SMA simply holds while price is above its moving average. Costs aren't modelled, so treat the edge over buy-and-hold — not the raw return — as the signal.">
        <BacktestClient initialSymbol={initial} />
      </Section>
    </div>
  );
}
