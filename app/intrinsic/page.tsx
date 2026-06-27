import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { FootballField } from "@/components/charts/FootballField";
import { ZoneBar } from "@/components/charts/ZoneBar";
import { PriceZoneChart } from "@/components/charts/PriceZoneChart";
import { Tornado } from "@/components/charts/Tornado";
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
    {
      key: "symbol",
      header: "Symbol",
      render: (v) => (
        <a href={`#${v.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
          {v.symbol}
        </a>
      ),
    },
    { key: "price", header: "Price", align: "right", mono: true, render: (v) => fmtRs(v.price, true) },
    { key: "intrinsic", header: "Intrinsic", align: "right", mono: true, render: (v) => (v.intrinsic == null ? "—" : fmtRs(v.intrinsic, true)) },
    {
      key: "band",
      header: "Range",
      align: "right",
      mono: true,
      render: (v) => (v.low == null || v.high == null ? "—" : <span className="text-muted text-[11px]">{fmtRs(v.low, true)}–{fmtRs(v.high, true)}</span>),
    },
    { key: "buyBelow", header: "Buy below", align: "right", mono: true, render: (v) => (v.buyBelow == null ? "—" : <span style={{ color: "var(--positive)" }}>{fmtRs(v.buyBelow, true)}</span>) },
    {
      key: "mos",
      header: "Margin of safety",
      align: "right",
      mono: true,
      render: (v) => <span style={{ color: v.marginOfSafetyPct == null ? "var(--muted)" : v.marginOfSafetyPct >= 0 ? "var(--positive)" : "var(--negative)" }}>{mos(v.marginOfSafetyPct)}</span>,
    },
    { key: "zone", header: "Zone", render: (v) => <Badge tone={zoneTone(v.zone)}>{v.zone}</Badge> },
    { key: "conf", header: "Confidence", render: (v) => <span className="label-cap">{v.confidence}</span> },
  ];

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Analysis"
        title="What each share is really worth."
        subtitle="An intrinsic value for every holding, blended from up to six independent models (discounted earnings, dividend-discount, Graham, earnings power, fair multiple — or look-through NAV for holding companies). From it we draw concrete buying zones: the price below which the stock is a buy, with the margin of safety scaled to how risky the stock is."
      >
        <Link href="/settings" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
          Edit assumptions
        </Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Section
        number="01"
        title="Buying zones at a glance"
        display={buys.length ? `${buys.length} in a buying zone.` : "Nothing in a buying zone today."}
        description={`Required return ${requiredReturnPct.toFixed(1)}% (SBP ${sbpRatePct.toFixed(1)}% + ${equityRiskPremiumPct.toFixed(0)}% equity premium); fair P/E ${fairPE}×. Both editable in Settings. "Buy below" already bakes in each stock's risk-scaled margin of safety.`}
      >
        <Table columns={cols} rows={items} rowKey={(v) => v.symbol} empty="No holdings to value yet." />
        <p className="text-[11px] text-muted mt-3 max-w-[85ch]">
          Intrinsic value is an estimate, not a promise — it moves as earnings, dividends and the SBP rate change. The
          range column shows how far the individual models disagree; a tight range plus a high confidence read is the
          strongest signal. Holding companies are valued on look-through NAV (what they own), not earnings.
        </p>
      </Section>

      <Section number="02" title="Each holding, in depth" display="Why a zone is a zone." description="For every stock: the live price against its buying zones, all valuation methods on one scale, a year of price history shaded by zone, and how the value swings when the key assumptions move.">
        <div className="space-y-10">
          {items.map((v) => (
            <IntrinsicCard key={v.symbol} v={v} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "positive" | "negative"; sub?: string }) {
  return (
    <div>
      <div className="label-cap mb-1">{label}</div>
      <div className="font-display mono-num text-[24px] leading-none" style={{ fontVariationSettings: "'opsz' 144", color: tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : "var(--ink)" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-1">{sub}</div>}
    </div>
  );
}

function IntrinsicCard({ v }: { v: IntrinsicView }) {
  const tone = v.zone === "strong buy" || v.zone === "buy" ? "positive" : v.zone === "expensive" ? "negative" : undefined;
  return (
    <div id={v.symbol} className="border border-rule p-5 md:p-7 scroll-mt-24 fade-in" style={{ background: "var(--paper-2)" }}>
      {/* header */}
      <div className="flex items-baseline justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-baseline gap-3">
          <Link href={`/holdings/${v.symbol}`} className="font-mono font-medium text-[17px] hover:text-[var(--accent-deep)]">
            {v.symbol}
          </Link>
          <span className="text-muted text-[13px]">{v.name}</span>
          {v.basis === "nav" && <span className="label-cap border px-1 py-px" style={{ borderColor: "var(--rule)" }}>NAV basis</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="label-cap">{v.confidence} confidence</span>
          <Badge tone={tone === "positive" ? "positive" : tone === "negative" ? "negative" : "default"}>{v.zone}</Badge>
        </div>
      </div>

      {/* headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Live price" value={fmtRs(v.price, true)} />
        <Stat label="Intrinsic value" value={v.intrinsic == null ? "—" : fmtRs(v.intrinsic, true)} sub={v.low != null && v.high != null ? `range ${fmtRs(v.low, true)}–${fmtRs(v.high, true)}` : undefined} />
        <Stat label="Margin of safety" value={mos(v.marginOfSafetyPct)} tone={v.marginOfSafetyPct != null && v.marginOfSafetyPct >= 0 ? "positive" : "negative"} sub={`demands ${v.requiredMosPct.toFixed(0)}%`} />
        <Stat label="Buy below" value={v.buyBelow == null ? "—" : fmtRs(v.buyBelow, true)} tone="positive" sub={v.strongBuyBelow != null ? `strong buy ≤ ${fmtRs(v.strongBuyBelow, true)}` : undefined} />
      </div>

      {/* zone gauge */}
      <ZoneBar price={v.price} strongBuyBelow={v.strongBuyBelow} buyBelow={v.buyBelow} fairUpTo={v.fairUpTo} intrinsic={v.intrinsic} zone={v.zone} />

      {/* two columns: football field + why */}
      <div className="grid md:grid-cols-2 gap-6 mt-7">
        <div>
          <div className="label-cap mb-2">Valuation methods</div>
          <FootballField methods={v.methods} price={v.price} intrinsic={v.intrinsic} />
        </div>
        <div>
          <div className="label-cap mb-2">Why this zone</div>
          <ul className="space-y-2 text-[13px] text-muted">
            {v.drivers.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span style={{ color: "var(--accent-deep)" }}>—</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* price history with zones */}
      {v.history.length >= 5 && (
        <div className="mt-7">
          <div className="label-cap mb-2">Price vs buying zones · last year {v.annualVolPct != null && <span className="ml-2 normal-case tracking-normal">volatility {v.annualVolPct.toFixed(0)}%/yr</span>}</div>
          <PriceZoneChart history={v.history} strongBuyBelow={v.strongBuyBelow} buyBelow={v.buyBelow} fairUpTo={v.fairUpTo} intrinsic={v.intrinsic} />
        </div>
      )}

      {/* sensitivity */}
      {v.sensitivity.length > 0 && v.intrinsic != null && (
        <div className="mt-7">
          <div className="label-cap mb-2">What moves the value (sensitivity)</div>
          <Tornado rows={v.sensitivity} base={v.intrinsic} />
        </div>
      )}
    </div>
  );
}
