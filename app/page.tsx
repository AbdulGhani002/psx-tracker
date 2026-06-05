import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { SectorBar } from "@/components/charts/SectorBar";
import { BenchmarkChartLoader } from "@/components/charts/BenchmarkChartLoader";
import { RefreshPrices } from "@/components/layout/RefreshPrices";
import {
  getPortfolioSummary,
  getAllTransactions,
  getNetWorth,
  getTodaysMovers,
  getRiskMetrics,
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
  const [summary, allTx, netWorth, movers, risk] = await Promise.all([
    getPortfolioSummary(),
    getAllTransactions(),
    getNetWorth(),
    getTodaysMovers(),
    getRiskMetrics(),
  ]);

  const hasOtherAssets = netWorth.funds + netWorth.savings + netWorth.cash > 0;
  const hasMovers = movers.gainers.length + movers.losers.length > 0;
  const recent = allTx.slice(0, 5);
  const xirrLabel = summary.xirr != null ? fmtSignedPct(summary.xirr, 1) : "—";
  const xirrHint =
    summary.xirr != null
      ? `Annualised over ${Math.round(summary.xirrSpanDays)} days`
      : summary.xirrSpanDays < 90
      ? `Needs 90+ days (you're at ${Math.round(summary.xirrSpanDays)})`
      : "Out of range";
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
      >
        <RefreshPrices />
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      {hasMovers && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card>
            <div className="label-cap mb-2" style={{ color: "var(--positive)" }}>Today's gainers</div>
            <div className="space-y-1.5">
              {movers.gainers.length === 0 ? (
                <span className="text-[12px] text-muted">None up today.</span>
              ) : (
                movers.gainers.map((m) => (
                  <div key={m.symbol} className="flex justify-between font-mono mono-num text-[13px]">
                    <Link href={`/holdings/${m.symbol}`} className="font-medium hover:text-[var(--accent-deep)]">{m.symbol}</Link>
                    <span style={{ color: "var(--positive)" }}>{fmtSignedPct(m.changePct, 2)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card>
            <div className="label-cap mb-2" style={{ color: "var(--negative)" }}>Today's losers</div>
            <div className="space-y-1.5">
              {movers.losers.length === 0 ? (
                <span className="text-[12px] text-muted">None down today.</span>
              ) : (
                movers.losers.map((m) => (
                  <div key={m.symbol} className="flex justify-between font-mono mono-num text-[13px]">
                    <Link href={`/holdings/${m.symbol}`} className="font-medium hover:text-[var(--accent-deep)]">{m.symbol}</Link>
                    <span style={{ color: "var(--negative)" }}>{fmtSignedPct(m.changePct, 2)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {hasOtherAssets && (
        <Link href="/assets" className="block mb-6">
          <Card>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="label-cap">Net worth (all assets)</div>
                <div className="font-display mono-num text-[28px] mt-1" style={{ fontVariationSettings: "'opsz' 144" }}>
                  {fmtRs(netWorth.total)}
                </div>
              </div>
              <div className="flex gap-5 font-mono mono-num text-[12px]">
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Equities</div>
                  <div>{fmtRs(netWorth.equity)}</div>
                </div>
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Funds</div>
                  <div>{fmtRs(netWorth.funds)}</div>
                </div>
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Savings</div>
                  <div>{fmtRs(netWorth.savings)}</div>
                </div>
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Cash</div>
                  <div>{fmtRs(netWorth.cash)}</div>
                </div>
              </div>
            </div>
          </Card>
        </Link>
      )}

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
          hint={xirrHint}
          tone={
            summary.xirr == null ? "muted" : summary.xirr >= 0 ? "positive" : "negative"
          }
        />
        <Stat
          label={`Dividends ${summary.taxYearLabel}`}
          value={fmtRs(summary.dividendsYTD)}
          hint={
            totalReturnPct != null
              ? `Total return ${fmtSignedPct(totalReturnPct, 1)}`
              : "PK tax year (Jul–Jun)"
          }
        />
      </StatRow>

      <Section
        number="01"
        title="Allocation snapshot"
        display="Where the money sits today."
        description="Current allocation vs. target. Deviations outside the rebalance band are flagged. Historical positions (0 shares) are hidden — see them on /holdings."
      >
        <Table
          columns={positionColumns}
          rows={summary.positions.filter((r) => r.shares > 0)}
          rowKey={(r) => r.symbol}
          empty="No active holdings."
        />
      </Section>

      <Section
        number="02"
        title="Sector concentration"
        display="Exposure by industry."
        description="Visible weights across PSX sectors."
      >
        {summary.sectorBreakdown.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Add positions to see sector exposure.</p>
          </Card>
        ) : (
          <SectorBar entries={summary.sectorBreakdown} totalValue={summary.totalValue} />
        )}
      </Section>

      <Section
        number="03"
        title="Benchmark"
        display="Portfolio vs. KSE-100."
        description="Indexed to 100 at the start of the trailing 90 days. Both lines reflect daily close-to-close moves."
      >
        <BenchmarkChartLoader />
      </Section>

      {risk && risk.annualVol != null && (
        <Section
          number="04"
          title="Risk"
          display="How bumpy the ride is."
          description="From your portfolio's daily returns over the last year vs KSE-100. Annualised."
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Stat label="Volatility" value={fmtPct(risk.annualVol ?? 0, 1)} tone="muted" hint="annualised σ" />
            <Stat label="Sharpe" value={risk.sharpe != null ? risk.sharpe.toFixed(2) : "—"} tone={(risk.sharpe ?? 0) >= 1 ? "positive" : "default"} hint="return per unit risk" />
            <Stat label="Sortino" value={risk.sortino != null ? risk.sortino.toFixed(2) : "—"} tone={(risk.sortino ?? 0) >= 1 ? "positive" : "default"} hint="downside-adjusted" />
            <Stat label="Max drawdown" value={fmtPct(risk.maxDrawdown ?? 0, 1)} tone="negative" hint="peak-to-trough" />
            <Stat label="Beta vs KSE" value={risk.beta != null ? risk.beta.toFixed(2) : "—"} tone="muted" hint="market sensitivity" />
            <Stat label="Alpha" value={risk.alpha != null ? fmtSignedPct(risk.alpha, 1) : "—"} tone={(risk.alpha ?? 0) >= 0 ? "positive" : "negative"} hint="vs CAPM expectation" />
          </div>
        </Section>
      )}

      <Section
        number="05"
        title="Recent activity"
        display="The last five things you did."
        action={<Link href="/transactions" className="label-cap hover:text-[var(--accent-deep)]">All transactions →</Link>}
      >
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
