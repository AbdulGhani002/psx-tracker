import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { getValuations, checkDataAvailability, type HoldingValuation } from "@/lib/data";
import { fmtRs } from "@/lib/format";

export const dynamic = "force-dynamic";

function pe(v: number | null) {
  return v == null ? "—" : `${v.toFixed(1)}×`;
}
function pct(v: number | null, d = 1) {
  return v == null ? "—" : `${v.toFixed(d)}%`;
}
function verdictTone(v: HoldingValuation["verdict"]): "positive" | "negative" | "default" {
  return v === "cheap" ? "positive" : v === "expensive" ? "negative" : "default";
}

export default async function ValuationPage() {
  const avail = await checkDataAvailability();
  const { valuations, requiredReturnPct, fairPE, sbpRatePct } = await getValuations();
  const missingBook = valuations.filter((v) => v.bookValuePerShare <= 0).map((v) => v.symbol);

  const cols: Column<HoldingValuation>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (v) => (
        <Link href={`/holdings/${v.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
          {v.symbol}
        </Link>
      ),
    },
    { key: "price", header: "Price", align: "right", mono: true, render: (v) => fmtRs(v.price, true) },
    { key: "eps", header: "EPS", align: "right", mono: true, render: (v) => (v.eps == null ? "—" : fmtRs(v.eps, true)) },
    { key: "pe", header: "P/E", align: "right", mono: true, render: (v) => pe(v.pe) },
    { key: "pb", header: "P/B", align: "right", mono: true, render: (v) => pe(v.pb) },
    { key: "roe", header: "ROE", align: "right", mono: true, render: (v) => pct(v.roePct, 0) },
    { key: "ey", header: "Earn. yield", align: "right", mono: true, render: (v) => pct(v.earningsYieldPct, 0) },
    { key: "dy", header: "Div. yield", align: "right", mono: true, render: (v) => <span style={{ color: "var(--positive)" }}>{pct(v.dividendYieldPct, 1)}</span> },
    { key: "fair", header: "Fair value", align: "right", mono: true, render: (v) => (v.fairValue == null ? "—" : fmtRs(v.fairValue, true)) },
    {
      key: "mos",
      header: "Margin of safety",
      align: "right",
      mono: true,
      render: (v) => (
        <span style={{ color: v.marginOfSafetyPct == null ? "var(--muted)" : v.marginOfSafetyPct >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {v.marginOfSafetyPct == null ? "—" : `${v.marginOfSafetyPct >= 0 ? "+" : ""}${v.marginOfSafetyPct.toFixed(0)}%`}
        </span>
      ),
    },
    { key: "verdict", header: "Verdict", render: (v) => <Badge tone={verdictTone(v.verdict)}>{v.verdict}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Analysis"
        title="What you own, and what it's worth."
        subtitle="Valuation for every holding. P/E, yields and a fair value are computed automatically from the EPS and dividends we scrape. Fair value blends a dividend-discount model with an earnings multiple; margin of safety is how far the price sits below fair value."
      >
        <div className="flex items-center gap-4">
          <a href="/api/export?sheet=valuation" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
            Download CSV
          </a>
          <Link href="/settings" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
            Edit assumptions
          </Link>
        </div>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <Section
        number="01"
        title="Valuation by holding"
        display="Cheap, fair, or expensive."
        description={`Fair value uses a required return of ${requiredReturnPct.toFixed(1)}% (SBP ${sbpRatePct.toFixed(1)}% + your equity premium) and a fair P/E of ${fairPE}. Both are editable in Settings. P/B and ROE need a book value per share — enter it on each holding's page.`}
      >
        <Table columns={cols} rows={valuations} rowKey={(v) => v.symbol} empty="No holdings to value yet." />
        {missingBook.length > 0 && (
          <p className="text-[11px] text-muted mt-3 max-w-[80ch]">
            No book value set for {missingBook.join(", ")} — so P/B and ROE are blank for them. Add it on each holding&apos;s
            page (it&apos;s on the company&apos;s balance sheet: total equity ÷ shares). Everything else is automatic.
          </p>
        )}
      </Section>
    </div>
  );
}
