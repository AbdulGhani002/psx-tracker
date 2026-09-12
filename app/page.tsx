import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/Skeleton";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { PerformancePanel } from "@/components/charts/PerformancePanel";
import { Heatmap } from "@/components/charts/Heatmap";
import { Sparkline } from "@/components/ui/Sparkline";
import { RefreshPrices } from "@/components/layout/RefreshPrices";
import { WhatChanged, type ZoneSnapshotRow } from "@/components/layout/WhatChanged";
import { getPortfolioSummary, checkDataAvailability, getAttribution, getZoneBoard, getEffectiveInflationPct } from "@/lib/data";
import { getToday, getPortfolioCards, getRecentActivity, getPerformance, getAllocation } from "@/lib/analytics/dashboard";
import { selectedPortfolio } from "@/lib/portfolios";
import { realPct } from "@/lib/calculations/pk-tax";
import { fmtRs, fmtSignedRs, fmtSignedPct, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// The overview streams: the cards first, then each panel as its data lands.
// The readers are wrapped in React cache() (lib/data.ts), so panels that share
// the portfolio summary compute it once per request.

function Fallback({ h = 120 }: { h?: number }) {
  return <Skeleton className="w-full" style={{ height: h }} />;
}

const k = (v: number) => (Math.abs(v) >= 1e7 ? `Rs ${(v / 1e6).toFixed(2)}M` : fmtRs(v));

async function Cards() {
  const [avail, summary, today, alloc, inf] = await Promise.all([checkDataAvailability(), getPortfolioSummary(), getToday(), getAllocation(), getEffectiveInflationPct()]);
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const totalReturnPct = summary.totalCost > 0 ? (totalReturn / summary.totalCost) * 100 : null;
  const realXirr = summary.xirr != null && inf.pct != null ? realPct(summary.xirr * 100, inf.pct) : null;
  return (
    <>
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <StatRow>
        <Stat label="Total net worth" value={k(alloc.total)} size="lg" hint={`Equities ${k(alloc.equity)} · funds ${k(alloc.funds)}${alloc.savings > 0 ? ` · savings ${k(alloc.savings)}` : ""}`} />
        <Stat label={`Today's P&L${today.asOf ? ` · ${fmtDate(today.asOf)}` : ""}`} value={fmtSignedRs(today.profit)} size="lg" tone={today.profit >= 0 ? "positive" : "negative"} delta={fmtSignedPct(today.profitPct / 100, 2)} deltaTone={today.profit >= 0 ? "positive" : "negative"} hint="Yesterday's holdings at today's closes" />
        <Stat label="Total return" value={fmtSignedRs(totalReturn)} size="lg" tone={totalReturn >= 0 ? "positive" : "negative"} delta={totalReturnPct != null ? fmtSignedPct(totalReturnPct / 100, 1) : undefined} deltaTone={totalReturn >= 0 ? "positive" : "negative"} hint={`Unrealised ${fmtSignedRs(summary.unrealizedPL)} · realised ${fmtSignedRs(summary.realizedPL)} · dividends ${fmtRs(summary.dividendsTotal)}`} />
        <Stat label="Invested" value={k(summary.totalCost)} size="lg" hint={summary.xirr != null ? `XIRR ${fmtSignedPct(summary.xirr, 1)}${realXirr != null ? ` · real ${realXirr >= 0 ? "+" : ""}${realXirr.toFixed(1)}%` : ""}` : "Cost of what you hold"} />
        <Stat label="Available cash" value={k(alloc.availableCash)} size="lg" hint={`Money-market fund ${k(alloc.funds)}${alloc.brokerCash > 0 ? ` · brokerage ${k(alloc.brokerCash)}` : ""}`} />
      </StatRow>
    </>
  );
}

async function PerformanceCard() {
  const alloc = await getAllocation();
  return (
    <Card title="Portfolio performance" eyebrow="Value against the KSE-100, started at the same point">
      <PerformancePanel initialRange="1Y" netWorthNow={alloc.total} />
    </Card>
  );
}

async function AllocationCard() {
  const alloc = await getAllocation();
  return (
    <Card title="Asset allocation" eyebrow="Where the money sits">
      <AllocationDonut slices={alloc.slices} centerValue={String(alloc.slices.length)} centerLabel="classes" />
    </Card>
  );
}

async function PortfolioCardsRow() {
  const [cards, selected] = await Promise.all([getPortfolioCards(), selectedPortfolio()]);
  if (cards.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="text-[12px] text-muted mb-2">
        {selected ? `Showing ${selected.name}. ` : "All portfolios. "}
        <Link href="/settings#portfolios" className="link-underline">Manage portfolios</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 stagger">
        {cards.map((c) => (
          <div key={c.portfolio._id} className="stat-card" style={{ borderTop: `2px solid ${c.portfolio.color}` }}>
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-muted">
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: c.portfolio.color }} />
                {c.portfolio.name}
                {c.portfolio.isDefault && <span className="ml-1.5 text-[10px]">default</span>}
              </div>
              {c.change30Pct != null && (
                <span className="pill" data-tone={c.change30Pct >= 0 ? "positive" : "negative"}>
                  {c.change30Pct >= 0 ? "+" : ""}{c.change30Pct.toFixed(1)}% 30d
                </span>
              )}
            </div>
            <div className="mono-num text-[22px] font-semibold mt-1.5">{k(c.total)}</div>
            <div className="flex items-end justify-between mt-1">
              <div className="text-[11px] text-muted">{c.names} names · equities {k(c.equity)}{c.funds > 0 ? ` · funds ${k(c.funds)}` : ""}</div>
              <Sparkline points={c.spark} width={90} height={24} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function MoversCard() {
  const today = await getToday();
  const Row = ({ n }: { n: (typeof today.names)[number] }) => (
    <div className="flex items-center justify-between py-2 border-b border-[var(--rule)] last:border-0">
      <div className="min-w-0">
        <Link href={`/holdings/${n.symbol}`} className="font-medium text-[13px] hover:text-[var(--accent-deep)]">{n.symbol}</Link>
        <div className="text-[11px] text-muted truncate">{n.name}</div>
      </div>
      <div className="text-right">
        <div className="font-mono mono-num text-[13px]">{n.price.toFixed(2)}</div>
        <div className="font-mono mono-num text-[11.5px]" style={{ color: n.changePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
          {n.changePct >= 0 ? "+" : ""}{n.changePct.toFixed(2)}% · {fmtSignedRs(n.profit)}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <Card title="Top gainers" eyebrow={today.asOf ? `Session of ${fmtDate(today.asOf)}` : undefined}>
        {today.gainers.length === 0 ? <div className="text-[12px] text-muted">None up.</div> : today.gainers.map((n) => <Row key={n.symbol} n={n} />)}
      </Card>
      <Card title="Top losers" eyebrow={today.asOf ? `Session of ${fmtDate(today.asOf)}` : undefined}>
        {today.losers.length === 0 ? <div className="text-[12px] text-muted">None down.</div> : today.losers.map((n) => <Row key={n.symbol} n={n} />)}
      </Card>
    </>
  );
}

async function ActivityCard() {
  const items = await getRecentActivity(8);
  return (
    <Card title="Recent activity" eyebrow="Trades, payouts and cash" action={<Link href="/transactions" className="text-[12px] link-underline">All</Link>}>
      {items.length === 0 ? (
        <div className="text-[12px] text-muted">Nothing yet.</div>
      ) : (
        items.map((a, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--rule)] last:border-0">
            <div className="min-w-0">
              <div className="text-[13px]">
                <span className="text-muted">{a.kind}</span> <span className="font-medium">{a.symbol}</span>
              </div>
              <div className="text-[11px] text-muted truncate">{a.text || fmtDate(a.date)}</div>
            </div>
            <div className="text-right">
              <div className="font-mono mono-num text-[12.5px]" style={{ color: a.amount > 0 ? "var(--positive)" : a.amount < 0 ? "var(--ink)" : "var(--muted)" }}>
                {a.amount === 0 ? "" : fmtSignedRs(a.amount)}
              </div>
              <div className="text-[10.5px] text-muted">{fmtDate(a.date)}</div>
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

async function HeatmapCard() {
  const perf = await getPerformance("ALL").catch(() => null);
  if (!perf) return null;
  const s = perf.summary;
  return (
    <Card title="Performance heatmap" eyebrow="Time-weighted return by month; the market is on the Analytics page" action={<Link href="/analytics" className="text-[12px] link-underline">Analytics</Link>}>
      <Heatmap table={perf.monthly} years={3} />
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-[12px]">
          <div><div className="text-muted">Since {fmtDate(s.from)}</div><div className="font-mono mono-num" style={{ color: s.twrPct >= 0 ? "var(--positive)" : "var(--negative)" }}>{s.twrPct >= 0 ? "+" : ""}{s.twrPct.toFixed(1)}%{s.benchPct != null ? <span className="text-muted"> · KSE-100 {s.benchPct >= 0 ? "+" : ""}{s.benchPct.toFixed(1)}%</span> : null}</div></div>
          <div><div className="text-muted">Months up</div><div className="font-mono mono-num">{Math.round(perf.monthly.positiveShare * 100)}% of {perf.monthly.months}</div></div>
          <div><div className="text-muted">Best month</div><div className="font-mono mono-num" style={{ color: "var(--positive)" }}>{perf.monthly.best ? `+${(perf.monthly.best.ret * 100).toFixed(1)}% · ${perf.monthly.best.year}-${String(perf.monthly.best.month).padStart(2, "0")}` : "–"}</div></div>
          <div><div className="text-muted">Worst month</div><div className="font-mono mono-num" style={{ color: "var(--negative)" }}>{perf.monthly.worst ? `${(perf.monthly.worst.ret * 100).toFixed(1)}% · ${perf.monthly.worst.year}-${String(perf.monthly.worst.month).padStart(2, "0")}` : "–"}</div></div>
        </div>
      )}
    </Card>
  );
}

async function AttributionCard() {
  const a = await getAttribution(30).catch(() => null);
  if (!a || a.contributions.length === 0) return null;
  const rows = a.contributions.slice(0, 8);
  return (
    <Card title="What moved it" eyebrow="Last 30 days, price only" action={<span className="font-mono mono-num text-[13px]" style={{ color: a.totalChangePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(a.totalChangePkr)}</span>}>
      <div className="space-y-2">
        {rows.map((c) => {
          const share = a.totalChangePkr !== 0 ? Math.min(1, Math.abs(c.changePkr) / Math.max(...rows.map((r) => Math.abs(r.changePkr)))) : 0;
          return (
            <div key={c.symbol} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-[12.5px]">
              <Link href={"/holdings/" + c.symbol} className="font-medium hover:text-[var(--accent-deep)]">{c.symbol}</Link>
              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }} />
              </div>
              <span className="font-mono mono-num" style={{ color: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.changePkr)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

async function WhatChangedBlock() {
  const board = await getZoneBoard().catch(() => null);
  if (!board) return null;
  const rows: ZoneSnapshotRow[] = board.rows
    .filter((r) => r.sharesHeld > 0 || r.alertsOn)
    .map((r) => ({ symbol: r.symbol, sector: r.sector ?? "", status: String(r.status), price: r.price, stale: r.priceStale, hasPlan: r.buyZoneHigh != null || r.sellZoneLow != null }));
  if (rows.length === 0) return null;
  return <WhatChanged rows={rows} />;
}

export default async function OverviewPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">Overview</h1>
          <div className="text-[12px] text-muted mt-0.5">Consolidated view of what you own, how it moved, and where it stands.</div>
        </div>
        <RefreshPrices />
      </div>

      <Suspense fallback={<Fallback h={100} />}>
        <Cards />
      </Suspense>

      <Suspense fallback={null}>
        <WhatChangedBlock />
      </Suspense>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          <Suspense fallback={<Fallback h={340} />}>
            <PerformanceCard />
          </Suspense>
        </div>
        <Suspense fallback={<Fallback h={340} />}>
          <AllocationCard />
        </Suspense>
      </div>

      <Suspense fallback={<Fallback h={110} />}>
        <PortfolioCardsRow />
      </Suspense>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <Suspense fallback={<><Fallback h={260} /><Fallback h={260} /></>}>
          <MoversCard />
        </Suspense>
        <Suspense fallback={<Fallback h={260} />}>
          <ActivityCard />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          <Suspense fallback={<Fallback h={220} />}>
            <HeatmapCard />
          </Suspense>
        </div>
        <Suspense fallback={<Fallback h={220} />}>
          <AttributionCard />
        </Suspense>
      </div>
    </div>
  );
}
