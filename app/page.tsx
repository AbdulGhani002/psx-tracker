import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { SectorBar } from "@/components/charts/SectorBar";
import {
  getPortfolioSummary,
  getAllTransactions,
  checkDataAvailability,
} from "@/lib/data";
import {
  fmtRs,
  fmtSignedRs,
  fmtSignedPct,
  fmtPct,
  fmtDate,
  fmtDateTime,
} from "@/lib/format";
import type { PositionRow } from "@/lib/calculations";
import type { Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const avail = await checkDataAvailability();
  const [summary, allTx] = await Promise.all([
    getPortfolioSummary(),
    getAllTransactions(),
  ]);

  const recent = allTx.slice(0, 5);
  const xirrLabel = summary.xirr != null ? fmtSignedPct(summary.xirr, 1) : "—";
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const totalReturnPct =
    summary.totalCost > 0 ? totalReturn / summary.totalCost : null;

  const positionColumns: Column<PositionRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (r) => (
        <Link
          href={`/holdings/${r.symbol}`}
          className="font-mono font-medium hover:text-[var(--accent-deep)]"
        >
          {r.symbol}
        </Link>
      ),
    },
    { key: "sector", header: "Sector", render: (r) => <span className="text-[12px] text-muted">{r.sector}</span> },
    { key: "value", header: "Market Value", align: "right", mono: true, render: (r) => fmtRs(r.marketValue) },
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
    {
      key: "unr",
      header: "Unrealised",
      align: "right",
      mono: true,
      render: (r) => (
        <span style={{ color: r.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {fmtSignedPct(r.unrealizedPct)}
        </span>
      ),
    },
  ];

  const recentColumns: Column<Transaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="font-mono text-[12px]">{fmtDate(t.date)}</span> },
    { key: "symbol", header: "Symbol", render: (t) => <span className="font-mono font-medium">{t.symbol}</span> },
    {
      key: "type",
      header: "Type",
      render: (t) => (
        <Badge
          tone={
            t.type === "BUY" || t.type === "RIGHT"
              ? "accent"
              : t.type === "SELL"
              ? "negative"
              : t.type === "DIVIDEND"
              ? "positive"
              : "amber"
          }
        >
          {t.type}
        </Badge>
      ),
    },
    { key: "amt", header: "Net", align: "right", mono: true, render: (t) => fmtRs(t.netAmount) },
    { key: "notes", header: "Notes", render: (t) => <span className="text-[12px] text-muted">{t.notes}</span> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Your portfolio."
        subtitle={`As of ${fmtDateTime(new Date())}`}
        italic={false}
      />

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Total Value" value={fmtRs(summary.totalValue)} />
        <Stat label="Cost Basis" value={fmtRs(summary.totalCost)} />
        <Stat
          label="Unrealised P/L"
          value={fmtSignedRs(summary.unrealizedPL)}
          tone={summary.unrealizedPL >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Realised P/L"
          value={fmtSignedRs(summary.realizedPL)}
          tone={summary.realizedPL >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="XIRR"
          value={xirrLabel}
          tone={
            summary.xirr == null ? "muted" : summary.xirr >= 0 ? "positive" : "negative"
          }
        />
        <Stat
          label="Dividends YTD"
          value={fmtRs(summary.dividendsYTD)}
          hint={
            totalReturnPct != null
              ? `Total return ${fmtSignedPct(totalReturnPct, 1)}`
              : undefined
          }
        />
      </StatRow>

      <Section number="01" title="Allocation snapshot" description="Current allocation vs. target. Deviations outside the rebalance band are flagged.">
        <Table
          columns={positionColumns}
          rows={summary.positions}
          rowKey={(r) => r.symbol}
          empty="No holdings."
        />
      </Section>

      <Section number="02" title="Sector concentration" description="Exposure by PSX sector across all positions.">
        {summary.sectorBreakdown.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Add positions to see sector exposure.</p>
          </Card>
        ) : (
          <SectorBar entries={summary.sectorBreakdown} totalValue={summary.totalValue} />
        )}
      </Section>

      <Section number="03" title="Sharia compliance">
        {summary.totalValue === 0 ? (
          <Card>
            <p className="text-sm text-muted">No data yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <div className="label-cap">Sharia-compliant</div>
              <div className="font-display mono-num text-[28px] mt-1" style={{ fontVariationSettings: "'opsz' 144" }}>
                {fmtPct(summary.shariaBreakdown.compliantPercent / 100, 1)}
              </div>
              <div className="text-[12px] text-muted font-mono mt-1">
                {fmtRs(summary.shariaBreakdown.compliant)}
              </div>
            </Card>
            <Card>
              <div className="label-cap">Non-compliant</div>
              <div className="font-display mono-num text-[28px] mt-1" style={{ fontVariationSettings: "'opsz' 144" }}>
                {fmtPct(1 - summary.shariaBreakdown.compliantPercent / 100, 1)}
              </div>
              <div className="text-[12px] text-muted font-mono mt-1">
                {fmtRs(summary.shariaBreakdown.nonCompliant)}
              </div>
            </Card>
          </div>
        )}
      </Section>

      <Section number="04" title="Recent activity" action={<Link href="/transactions" className="label-cap hover:text-[var(--accent-deep)]">All transactions →</Link>}>
        <Table
          columns={recentColumns}
          rows={recent}
          rowKey={(t) => String(t._id)}
          empty="No transactions recorded yet."
        />
      </Section>
    </div>
  );
}
