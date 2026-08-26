import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Term } from "@/components/ui/Term";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { SectorBar } from "@/components/charts/SectorBar";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { BenchmarkChartLoader } from "@/components/charts/BenchmarkChartLoader";
import { RefreshPrices } from "@/components/layout/RefreshPrices";
import { WhatChanged, type ZoneSnapshotRow } from "@/components/layout/WhatChanged";
import {
  getPortfolioSummary,
  getAllTransactions,
  getNetWorth,
  getTodaysMovers,
  getRiskMetrics,
  getAppSettings,
  checkDataAvailability,
 getEffectiveInflationPct, getAttribution, getZoneBoard,} from "@/lib/data";
import { realPct } from "@/lib/calculations/pk-tax";
import {
  fmtRs,
  fmtUsd,
  fmtSignedRs,
  fmtSignedPct,
  fmtPct,
  fmtDate,
  fmtDateTime,
} from "@/lib/format";
import { getUsdPkr } from "@/lib/fx";
import type { PositionRow } from "@/lib/calculations";
import type { Transaction } from "@/lib/types";

export const dynamic = "force-dynamic";

// The page streams: the header flushes immediately, then each section below
// arrives as its data resolves. The data getters are wrapped in React cache()
// (lib/data.ts), so sections sharing the portfolio summary compute it ONCE per
// request — Suspense here costs no extra queries.

function BlockFallback({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 py-6">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

async function TopBlock() {
  const [avail, summary, netWorth, movers, usdPkr, inf] = await Promise.all([
    checkDataAvailability(),
    getPortfolioSummary(),
    getNetWorth(),
    getTodaysMovers(),
    getUsdPkr(),
    getEffectiveInflationPct(),
  ]);
  const usd = (rs: number) => (usdPkr ? `≈ ${fmtUsd(rs, usdPkr, false)}` : undefined);
  const hasOtherAssets = netWorth.funds + netWorth.savings > 0;
  const hasMovers = movers.gainers.length + movers.losers.length > 0;
  const xirrLabel = summary.xirr != null ? fmtSignedPct(summary.xirr, 1) : "—";
  // Real XIRR: the same annualised return with inflation taken out (Fisher). In
  // an 11% CPI economy the nominal figure alone flatters everything.
  const realXirr = summary.xirr != null && inf.pct != null ? realPct(summary.xirr * 100, inf.pct) : null;
  const xirrHint =
    summary.xirr != null
      ? `Annualised over ${Math.round(summary.xirrSpanDays)} days${
          realXirr != null ? ` · real ${realXirr >= 0 ? "+" : ""}${realXirr.toFixed(1)}% after ${inf.pct!.toFixed(1)}% CPI` : ""
        }`
      : summary.xirrSpanDays < 90
      ? `Needs 90+ days (you're at ${Math.round(summary.xirrSpanDays)})`
      : "Out of range";
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const totalReturnPct = summary.totalCost > 0 ? totalReturn / summary.totalCost : null;

  return (
    <>
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
                <div className="font-display mono-num text-[28px] mt-1">
                  {fmtRs(netWorth.total)}
                </div>
                {usdPkr && <div className="font-mono text-[12px] text-muted mt-0.5">{usd(netWorth.total)}</div>}
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
              </div>
            </div>
          </Card>
        </Link>
      )}

      <StatRow>
        <Stat label="Total Value" value={fmtRs(summary.totalValue)} hint={usd(summary.totalValue)} />
        <Stat label="Cost Basis" value={fmtRs(summary.totalCost)} hint={usd(summary.totalCost)} />
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
          tone={summary.xirr == null ? "muted" : summary.xirr >= 0 ? "positive" : "negative"}
        />
        <Stat
          label={`Dividends ${summary.taxYearLabel}`}
          value={fmtRs(summary.dividendsYTD)}
          hint={totalReturnPct != null ? `Total return ${fmtSignedPct(totalReturnPct, 1)}` : "PK tax year (Jul–Jun)"}
        />
      </StatRow>
    </>
  );
}

// The month's change, split by holding — so the number at the top has a WHY.
async function AttributionBlock() {
  const a = await getAttribution(30).catch(() => null);
  if (!a || a.contributions.length === 0) return null;
  const rows = a.contributions.slice(0, 6);
  const anyPartial = rows.some((c) => c.partialWindow);
  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <span className="label-cap">What moved it — last 30 days (price only)</span>
        <span className="font-mono mono-num text-[13px]" style={{ color: a.totalChangePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {a.totalChangePkr >= 0 ? "+" : ""}{fmtRs(a.totalChangePkr)}
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((c) => (
          <div key={c.symbol} className="grid grid-cols-[64px_1fr_auto_auto] items-baseline gap-3 font-mono mono-num text-[13px]">
            <Link href={"/holdings/" + c.symbol} className="font-medium hover:text-[var(--accent-deep)]">{c.symbol}{c.partialWindow ? "†" : ""}</Link>
            <span className="text-[11px] text-muted truncate">{fmtRs(c.priceThen, true)} → {fmtRs(c.priceNow, true)}</span>
            <span style={{ color: c.pricePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedPct(c.pricePct)}</span>
            <span className="text-right min-w-[90px]" style={{ color: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {c.changePkr >= 0 ? "+" : ""}{fmtRs(c.changePkr)}
            </span>
          </div>
        ))}
      </div>
      {(anyPartial || a.excluded.length > 0) && (
        <p className="text-[10px] text-muted mt-3">
          {anyPartial ? "† price history starts inside the window, so this move is measured from the first available quote. " : ""}
          {a.excluded.length > 0 ? "Not shown (no usable prices): " + a.excluded.map((e) => e.symbol).join(", ") + "." : ""}
        </p>
      )}
    </Card>
  );
}

async function AllocationBlock() {
  const [summary, netWorth, settings] = await Promise.all([
    getPortfolioSummary(),
    getNetWorth(),
    getAppSettings(),
  ]);
  const cap = settings.concentrationCap ?? 25;
  const active = summary.positions.filter((p) => p.shares > 0);
  const topPos = [...active].sort((a, b) => b.currentPercent - a.currentPercent)[0];
  const topSector = summary.sectorBreakdown[0];
  const cashBufferPct = netWorth.total > 0 ? (netWorth.savings / netWorth.total) * 100 : 0;
  const signals: Array<{ ok: boolean; text: string }> = [];
  if (topPos) {
    signals.push({
      ok: topPos.currentPercent <= cap,
      text: topPos.currentPercent <= cap
        ? `Largest position ${topPos.symbol} ${topPos.currentPercent.toFixed(1)}% — within the ${cap}% cap`
        : `${topPos.symbol} is ${topPos.currentPercent.toFixed(1)}% — over your ${cap}% single-stock cap, consider trimming`,
    });
  }
  if (topSector) {
    signals.push({
      ok: topSector.percent <= 40,
      text: topSector.percent <= 40
        ? `Top sector ${topSector.sector} ${topSector.percent.toFixed(1)}% — under 40%`
        : `${topSector.sector} is ${topSector.percent.toFixed(1)}% of equities — over the 40% sector cap`,
    });
  }
  signals.push({
    ok: cashBufferPct >= 5,
    text: cashBufferPct >= 5
      ? `Cash + savings buffer ${cashBufferPct.toFixed(1)}% — dry powder available`
      : `Only ${cashBufferPct.toFixed(1)}% in cash/savings — under the 5% buffer for opportunities`,
  });

  const positionColumns: Column<PositionRow>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (r) => (
        <Link href={`/holdings/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
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

  return (
    <>
      {active.length > 0 && (
        <Section title="Portfolio signals" display="Sizing discipline at a glance.">
          <Card>
            <ul className="space-y-2.5">
              {signals.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[14px]">
                  <span aria-hidden style={{ color: s.ok ? "var(--positive)" : "var(--negative)" }}>
                    {s.ok ? "✓" : "!"}
                  </span>
                  <span style={{ color: s.ok ? "var(--ink)" : "var(--negative)" }}>{s.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <Section
        number="01"
        title="Allocation snapshot"
        display="Where the money sits today."
        description="Current allocation vs. target. Deviations outside the rebalance band are flagged. Historical positions (0 shares) are hidden — see them on /holdings."
      >
        {active.length > 0 && (
          <Card className="mb-6">
            <div className="label-cap mb-4">Equity allocation by holding</div>
            <AllocationDonut
              slices={active.map((p) => ({ label: p.symbol, value: p.marketValue }))}
              centerValue={fmtRs(summary.totalValue, true)}
              centerLabel="Equities"
            />
          </Card>
        )}
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
    </>
  );
}

async function RiskBlock() {
  const risk = await getRiskMetrics();
  if (!risk || risk.annualVol == null) return null;
  return (
    <Section
      number="04"
      title="Risk"
      display="How bumpy the ride is."
      description="From your portfolio's daily returns over the last year vs KSE-100. Annualised."
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Stat label="Volatility" value={fmtPct(risk.annualVol ?? 0, 1)} tone="muted" hint="annualised σ" />
        <Stat label={<Term k="sharpe">Sharpe</Term>} value={risk.sharpe != null ? risk.sharpe.toFixed(2) : "—"} tone={(risk.sharpe ?? 0) >= 1 ? "positive" : "default"} hint="return per unit risk" />
        <Stat label="Sortino" value={risk.sortino != null ? risk.sortino.toFixed(2) : "—"} tone={(risk.sortino ?? 0) >= 1 ? "positive" : "default"} hint="downside-adjusted" />
        <Stat label={<Term k="drawdown">Max drawdown</Term>} value={fmtPct(risk.maxDrawdown ?? 0, 1)} tone="negative" hint="peak-to-trough" />
        <Stat label={<Term k="beta">Beta vs KSE</Term>} value={risk.beta != null ? risk.beta.toFixed(2) : "—"} tone="muted" hint="market sensitivity" />
        <Stat label={<Term k="alpha">Alpha</Term>} value={risk.alpha != null ? fmtSignedPct(risk.alpha, 1) : "—"} tone={(risk.alpha ?? 0) >= 0 ? "positive" : "negative"} hint="vs CAPM expectation" />
      </div>
    </Section>
  );
}

async function RecentBlock() {
  const allTx = await getAllTransactions();
  const recent = allTx.slice(0, 5);
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
    <Section
      number="05"
      title="Recent activity"
      display="The last five things you did."
      action={<Link href="/transactions" className="label-cap hover:text-[var(--accent-deep)]">All transactions →</Link>}
    >
      <Table columns={recentColumns} rows={recent} rowKey={(t) => String(t._id)} empty="No transactions recorded yet." />
    </Section>
  );
}

// What crossed a line since the last visit. The server supplies today's zone
// statuses; the browser holds the previous ones and does the diff.
async function WhatChangedBlock() {
  const board = await getZoneBoard().catch(() => null);
  if (!board) return null;
  const rows: ZoneSnapshotRow[] = board.rows
    .filter((r) => r.sharesHeld > 0 || r.alertsOn)
    .map((r) => ({
      symbol: r.symbol,
      sector: r.sector ?? "",
      status: String(r.status),
      price: r.price,
      stale: r.priceStale,
      hasPlan: r.buyZoneHigh != null || r.sellZoneLow != null,
    }));
  if (rows.length === 0) return null;
  return <WhatChanged rows={rows} />;
}

export default function Dashboard() {
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

      <Suspense fallback={<BlockFallback rows={5} />}>
        <TopBlock />
      </Suspense>

      <Suspense fallback={null}>
        <WhatChangedBlock />
      </Suspense>

      <Suspense fallback={null}>
        <AttributionBlock />
      </Suspense>

      <Suspense fallback={<BlockFallback rows={6} />}>
        <AllocationBlock />
      </Suspense>

      <Section
        number="03"
        title="Benchmark"
        display="Portfolio vs. KSE-100."
        description="Indexed to 100 at the start of the window. 'Portfolio + dividends' is your real total return (dividends reinvested); the faint 'price only' line excludes them — the gap between the two is what your dividends add. KSE-100 is a price index, so the fair comparison is your total-return line vs the index."
      >
        <BenchmarkChartLoader />
      </Section>

      <Suspense fallback={<BlockFallback rows={2} />}>
        <RiskBlock />
      </Suspense>

      <Suspense fallback={<BlockFallback rows={3} />}>
        <RecentBlock />
      </Suspense>
    </div>
  );
}
