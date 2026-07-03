import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SimulatorClient } from "./SimulatorClient";

export const dynamic = "force-dynamic";

export default function CgtSimulatorPage() {
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Tax · What-if"
        title="Know the tax before you sell."
        subtitle="Pick a holding and a quantity: the simulator shows exactly which FIFO lots the sale would consume, the capital gain per lot, and the CGT at your filer rate — before you place the order."
      />
      <Section number="01" title="Sale simulator" description="Uses your real transaction history and live PSX prices. Drag the shares slider to find the sweet spot where you raise the cash you need without touching the low-cost, high-tax lots.">
        <SimulatorClient />
      </Section>
    </div>
  );
}
