import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { getPortfolioSummary, checkDataAvailability } from "@/lib/data";
import { fmtRs, fmtNum, fmtSignedPct, fmtPct } from "@/lib/format";
import type { PositionRow } from "@/lib/calculations";

export const dynamic = "force-dynamic";

export default async function HoldingsPage({
  searchParams,
}: {
  searchParams: { all?: string; added?: string; type?: string };
}) {
  const avail = await checkDataAvailability();
  const summary = await getPortfolioSummary();
  const showAll = searchParams?.all === "1";
  const added = searchParams?.added;
  const addedType = searchParams?.type;
  const active = summary.positions.filter((p) => p.shares > 0);
  const historical = summary.positions.filter((p) => p.shares <= 0);
  const rows = showAll ? summary.positions : active;

  const columns: Column<PositionRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (r) => (
        <Link
          href={`/holdings/${r.symbol}`}
          className="font-mono text-[13px] font-medium hover:text-[var(--accent-deep)]"
        >
          {r.symbol}
        </Link>
      ),
    },
    {
      key: "sector",
      header: "Sector",
      render: (r) => (
        <span className="text-[12px] text-muted">{r.sector}</span>
      ),
    },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (r) => fmtNum(r.shares) },
    { key: "avgCost", header: "Avg Cost", align: "right", mono: true, render: (r) => fmtRs(r.avgCost, true) },
    { key: "currentPrice", header: "Price", align: "right", mono: true, render: (r) => fmtRs(r.currentPrice, true) },
    { key: "marketValue", header: "Market Value", align: "right", mono: true, render: (r) => fmtRs(r.marketValue) },
    {
      key: "unrealizedPct",
      header: "Unrealised",
      align: "right",
      mono: true,
      render: (r) => (
        <span style={{ color: r.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {fmtSignedPct(r.unrealizedPct)}
        </span>
      ),
    },
    {
      key: "alloc",
      header: "% / Target",
      align: "right",
      mono: true,
      render: (r) => {
        const dev = Math.abs(r.deviation);
        const tone = dev <= 3 ? "positive" : dev <= 6 ? "amber" : "negative";
        return (
          <div className="flex items-center justify-end gap-2">
            <span>{fmtPct(r.currentPercent / 100, 1)}</span>
            <span className="text-muted">/</span>
            <span className="text-muted">{fmtPct(r.targetPercent / 100, 0)}</span>
            <Badge tone={tone as any}>{fmtSignedPct(r.deviation / 100, 1)}</Badge>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Holdings"
        title="The positions you hold."
        subtitle="Click a row to inspect cost basis, dividends, and a forward projection."
      >
        <div className="flex gap-3">
          <Link href="/transactions/new">
            <Button variant="solid">Add Transaction</Button>
          </Link>
          <Link href="/transactions">
            <Button variant="outline">View All Transactions</Button>
          </Link>
        </div>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      {added && (
        <div
          className="mb-6 flex items-center gap-3 border-l-[4px] px-4 py-3"
          style={{ borderColor: "var(--positive)", background: "var(--paper-2)" }}
        >
          <span aria-hidden style={{ color: "var(--positive)" }}>✓</span>
          <span className="text-[14px]">
            <span className="font-mono font-medium">{added}</span> {addedType ?? "transaction"} recorded.
            Its avg cost and P/L below have been updated.
          </span>
        </div>
      )}

      <Section
        number="01"
        title={`${rows.length} ${showAll ? "total" : "active"} positions`}
        action={
          historical.length > 0 ? (
            <Link
              href={showAll ? "/holdings" : "/holdings?all=1"}
              className="label-cap hover:text-[var(--accent-deep)]"
            >
              {showAll
                ? "Hide historical →"
                : `Show ${historical.length} historical →`}
            </Link>
          ) : undefined
        }
        description={
          historical.length > 0 && !showAll
            ? `${historical.length} symbol${historical.length > 1 ? "s" : ""} with no current shares (dividend-only history) hidden.`
            : undefined
        }
      >
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.symbol}
          empty="No holdings yet. Record your first transaction to begin."
        />
      </Section>
    </div>
  );
}
