import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { OptimizeClient } from "./OptimizeClient";

export const dynamic = "force-dynamic";

export default function OptimizePage() {
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Portfolio"
        title="The best mix, not just the best stock."
        subtitle="Modern Portfolio Theory on real PSX history: for a basket of stocks it finds the blend with the most return per unit of risk (max Sharpe) and the calmest blend (minimum volatility), and plots the efficient frontier between them."
      />
      <Section number="01" title="Optimiser" description="Enter two or more symbols. Returns and risk are annualised from up to two years of daily closes; correlations between the stocks do the real work — that's why a mix can beat its parts. Past performance isn't a forecast; this sizes risk, it doesn't predict price.">
        <OptimizeClient />
      </Section>
    </div>
  );
}
