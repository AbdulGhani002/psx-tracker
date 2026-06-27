import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { IntrinsicCard } from "./IntrinsicCard";
import { getIntrinsicValuations, checkDataAvailability, type IntrinsicView } from "@/lib/data";
import { fmtRs } from "@/lib/format";

export const dynamic = "force-dynamic";

function zoneTone(z: IntrinsicView["zone"]): "positive" | "negative" | "default" {
  return z === "strong buy" || z === "buy" ? "positive" : z === "expensive" ? "negative" : "default";
}
function mos(v: number | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

export default async function IntrinsicPage() {
  const avail = await checkDataAvailability();
  const { items, requiredReturnPct, sbpRatePct, equityRiskPremiumPct, fairPE } = await getIntrinsicValuations();

  const buys = items.filter((i) => i.zone === "strong buy" || i.zone === "buy");

  const cols: Column<IntrinsicView>[] = [
    { key: "symbol", header: "Symbol", render: (v) => <a href={`#${v.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{v.symbol}</a> },
    { key: "price", header: "Price", align: "right", mono: true, render: (v) => fmtRs(v.price, true) },
    { key: "intrinsic", header: "Intrinsic", align: "right", mono: true, render: (v) => (v.intrinsic == null ? "—" : fmtRs(v.intrinsic, true)) },
    { key: "band", header: "Range", align: "right", mono: true, render: (v) => (v.low == null || v.high == null ? "—" : <span className="text-muted text-[11px]">{fmtRs(v.low, true)}–{fmtRs(v.high, true)}</span>) },
    { key: "methods", header: "Models used", align: "right", mono: true, render: (v) => <span className="text-muted">{v.methods.filter((m) => m.included).length}</span> },
    { key: "buyBelow", header: "Buy below", align: "right", mono: true, render: (v) => (v.buyBelow == null ? "—" : <span style={{ color: "var(--positive)" }}>{fmtRs(v.buyBelow, true)}</span>) },
    { key: "mos", header: "Margin of safety", align: "right", mono: true, render: (v) => <span style={{ color: v.marginOfSafetyPct == null ? "var(--muted)" : v.marginOfSafetyPct >= 0 ? "var(--positive)" : "var(--negative)" }}>{mos(v.marginOfSafetyPct)}</span> },
    { key: "zone", header: "Zone", render: (v) => <Badge tone={zoneTone(v.zone)}>{v.zone}</Badge> },
  ];

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Analysis"
        title="What each share is really worth."
        subtitle="An intrinsic value for every holding, blended from up to six independent models — discounted earnings (DCF), dividend-discount, Graham's growth formula, the Graham number, earnings power value, and a fair P/E multiple (or look-through NAV for holding companies). Earnings are normalised through the cycle, growth is a multi-year trend, and any model that disagrees wildly with the rest is set aside so one broken number can't distort the value."
      >
        <Link href="/settings" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">Edit assumptions</Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Section
        number="01"
        title="Buying zones at a glance"
        display={buys.length ? `${buys.length} in a buying zone.` : "Nothing in a buying zone today."}
        description={`Required return ${requiredReturnPct.toFixed(1)}% (SBP ${sbpRatePct.toFixed(1)}% + ${equityRiskPremiumPct.toFixed(0)}% equity premium); fair P/E ${fairPE}×. "Buy below" already bakes in each stock's risk-scaled margin of safety. Open a row to drag those assumptions and watch the value move.`}
      >
        <Table columns={cols} rows={items} rowKey={(v) => v.symbol} empty="No holdings to value yet." />
        <p className="text-[11px] text-muted mt-3 max-w-[85ch]">
          "Models used" is how many of the six methods made it into the blend for that stock (a method is left out only when it lacks
          its inputs — e.g. no book value — or sits more than 50% away from the others). Tip: add a book value per share on each
          holding's page to unlock the Graham number and tighten the estimate.
        </p>
      </Section>

      <Section number="02" title="Each holding, in depth" display="Drag the assumptions. Watch it change." description="For every stock: every valuation method (which ones were blended, which were set aside), the live price against its buying zones, a year of price history shaded by zone, and a sensitivity tornado. Move the sliders and the intrinsic value, zones and charts recompute instantly.">
        <div className="space-y-10">
          {items.map((v) => (
            <IntrinsicCard key={v.symbol} v={v} />
          ))}
        </div>
      </Section>
    </div>
  );
}
