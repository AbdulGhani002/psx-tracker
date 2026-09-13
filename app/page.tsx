import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { Heatmap } from "@/components/charts/Heatmap";
import { Sparkline } from "@/components/ui/Sparkline";
import { RefreshPrices } from "@/components/layout/RefreshPrices";
import { NetWorthChart } from "@/components/dashboard/NetWorthChart";
import { StatCard } from "@/components/ui/StatCard";
import { getPortfolioSummary, checkDataAvailability, getAttribution } from "@/lib/data";
import { getToday, getPortfolioCards, getRecentActivity, getPerformance, getAllocation } from "@/lib/analytics/dashboard";
import { fmtRs, fmtSignedRs, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// The overview, laid out the way Zar lays it out: five figures across the
// top, the value line beside the allocation, then each portfolio on a card,
// then what moved today and what happened lately. Panels stream in as their
// readers land; the readers are wrapped in cache() so shared work runs once.

function Fallback({ h = 120 }: { h?: number }) {
  return <Skeleton className="w-full" style={{ height: h, borderRadius: 10 }} />;
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "P";

async function TopCards() {
  const [avail, summary, today, alloc] = await Promise.all([checkDataAvailability(), getPortfolioSummary(), getToday(), getAllocation()]);
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const totalReturnPct = summary.totalCost > 0 ? (totalReturn / summary.totalCost) * 100 : null;
  return (
    <>
      {!avail.available && <SetupBanner reason={avail.reason} />}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 stagger">
        <StatCard label="Total net worth" value={fmtRs(alloc.total)} />
        <StatCard label="Today's P&L" value={fmtSignedRs(today.profit)} tone={today.profit >= 0 ? "positive" : "negative"} delta={`${today.profitPct >= 0 ? "+" : ""}${today.profitPct.toFixed(2)}%`} deltaTone={today.profit >= 0 ? "positive" : "negative"} />
        <StatCard label="Total return" value={fmtSignedRs(totalReturn)} tone={totalReturn >= 0 ? "positive" : "negative"} delta={totalReturnPct != null ? `${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(2)}%` : undefined} deltaTone={totalReturn >= 0 ? "positive" : "negative"} />
        <StatCard label="Invested" value={fmtRs(summary.totalCost)} />
        <StatCard label="Available cash" value={fmtRs(alloc.availableCash)} />
      </div>
    </>
  );
}

async function ChartRow() {
  const [alloc, summary] = await Promise.all([getAllocation(), getPortfolioSummary()]);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
      <div className="xl:col-span-2 min-h-[340px]">
        <NetWorthChart title="Market value" value={summary.totalValue} />
      </div>
      <Card title="Asset allocation">
        <AllocationDonut slices={alloc.slices} centerValue={String(alloc.slices.filter((s) => s.value > 0).length)} centerLabel="Classes" />
      </Card>
    </div>
  );
}

async function PortfolioCardsRow() {
  const cards = await getPortfolioCards();
  if (cards.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[12px] text-muted">{cards.length === 1 ? "Your portfolio" : `${cards.length} portfolios`}</div>
        <Link href="/settings#portfolios" className="text-[12px] link-underline">Manage</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 stagger">
        {cards.map((c) => (
          <a key={c.portfolio._id} href={`/api/portfolios/select?id=${c.portfolio._id}&next=/portfolio`} className="card card-pad block hover:border-[var(--rule-strong)] transition-colors">
            <div className="flex items-center gap-2.5">
              <span className="initials text-[11px]" style={{ background: `color-mix(in srgb, ${c.portfolio.color} 18%, white)`, color: c.portfolio.color }}>{initials(c.portfolio.name)}</span>
              <span className="text-[13px] font-semibold truncate">{c.portfolio.name}</span>
              {c.portfolio.isDefault && <span className="ml-auto w-2 h-2 rounded-full" style={{ background: "var(--positive)" }} title="Default" />}
            </div>
            <div className="flex items-end justify-between gap-3 mt-3">
              <div>
                <div className="fig text-[17px] whitespace-nowrap">{fmtRs(c.total)}</div>
                <span className="pill mt-1.5" data-tone={c.dayProfit >= 0 ? "positive" : "negative"}>
                  {fmtSignedRs(c.dayProfit)}{c.dayPct != null ? ` (${c.dayPct >= 0 ? "+" : ""}${c.dayPct.toFixed(2)}%)` : ""}
                </span>
              </div>
              <Sparkline points={c.spark} width={72} height={28} />
            </div>
            <div className="mini-stats mt-3">
              <div><div className="label">Invested</div><div className="value">{fmtRs(c.invested)}</div></div>
              <div><div className="label">Unrealized</div><div className="value" style={{ color: c.unrealized >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.unrealized)}</div></div>
              <div><div className="label">Total return</div><div className="value" style={{ color: c.totalReturn >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.totalReturn)}</div></div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

async function MoversCard() {
  const today = await getToday();
  const Row = ({ n }: { n: (typeof today.names)[number] }) => (
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <Link href={`/holdings/${n.symbol}`} className="font-semibold text-[13px] hover:text-[var(--accent-deep)]">{n.symbol}</Link>
        <div className="text-[11px] text-muted truncate">{n.name}</div>
      </div>
      <div className="text-right">
        <div className="mono-num text-[13px]">{n.price.toFixed(2)}</div>
        <div className="mono-num text-[11.5px]" style={{ color: n.changePct >= 0 ? "var(--positive)" : "var(--negative)" }}>{n.changePct >= 0 ? "+" : ""}{n.changePct.toFixed(2)}% · {fmtSignedRs(n.profit)}</div>
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card title="Top gainers" eyebrow={today.asOf ? fmtDate(today.asOf) : undefined}>
        <div className="hairline-list">
          {today.gainers.length === 0 ? <div className="text-[12px] text-muted">None today.</div> : today.gainers.slice(0, 5).map((n) => <Row key={n.symbol} n={n} />)}
        </div>
      </Card>
      <Card title="Top losers" eyebrow={today.asOf ? fmtDate(today.asOf) : undefined}>
        <div className="hairline-list">
          {today.losers.length === 0 ? <div className="text-[12px] text-muted">None today.</div> : today.losers.slice(0, 5).map((n) => <Row key={n.symbol} n={n} />)}
        </div>
      </Card>
    </div>
  );
}

async function ActivityCard() {
  const items = await getRecentActivity(7);
  return (
    <Card title="Recent activity" action={<Link href="/portfolio?tab=trades" className="text-[12px] link-underline">All</Link>}>
      {items.length === 0 ? (
        <div className="text-[12px] text-muted">Nothing yet. Add a trade to begin.</div>
      ) : (
        <div className="hairline-list">
          {items.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] truncate"><span className="text-muted">{a.kind}</span> <span className="font-semibold">{a.symbol}</span></div>
                <div className="text-[11px] text-muted truncate">{a.text || fmtDate(a.date)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="mono-num text-[12.5px]" style={{ color: a.amount > 0 ? "var(--positive)" : a.amount < 0 ? "var(--ink)" : "var(--muted)" }}>{a.amount === 0 ? "" : fmtSignedRs(a.amount)}</div>
                <div className="text-[10.5px]" style={{ color: "var(--faint)" }}>{fmtDate(a.date)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

async function HeatmapCard() {
  const perf = await getPerformance("3Y").catch(() => null);
  return (
    <Card title="Performance heatmap" eyebrow="Monthly time-weighted return" action={<Link href="/portfolio?tab=analytics" className="text-[12px] link-underline">Analytics</Link>}>
      {perf ? <Heatmap table={perf.monthly} years={3} /> : <div className="text-[12px] text-muted">No months yet.</div>}
    </Card>
  );
}

async function AttributionCard() {
  const a = await getAttribution(30).catch(() => null);
  if (!a || a.contributions.length === 0) return null;
  const rows = a.contributions.slice(0, 8);
  const max = Math.max(...rows.map((r) => Math.abs(r.changePkr)), 1);
  return (
    <Card title="What moved it" eyebrow="Last 30 days, price only" action={<span className="mono-num text-[13px] font-semibold" style={{ color: a.totalChangePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(a.totalChangePkr)}</span>}>
      <div className="space-y-2.5">
        {rows.map((c) => (
          <div key={c.symbol} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-[12.5px]">
            <Link href={"/holdings/" + c.symbol} className="font-semibold hover:text-[var(--accent-deep)]">{c.symbol}</Link>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
              <div className="h-full rounded-full" style={{ width: `${(Math.abs(c.changePkr) / max) * 100}%`, background: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }} />
            </div>
            <span className="mono-num" style={{ color: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.changePkr)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <RefreshPrices />
      </div>
      <Suspense fallback={<Fallback h={84} />}>
        <TopCards />
      </Suspense>
      <Suspense fallback={<div className="mt-3"><Fallback h={340} /></div>}>
        <ChartRow />
      </Suspense>
      <Suspense fallback={<div className="mt-5"><Fallback h={160} /></div>}>
        <PortfolioCardsRow />
      </Suspense>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-5">
        <div className="xl:col-span-2">
          <Suspense fallback={<Fallback h={260} />}>
            <MoversCard />
          </Suspense>
        </div>
        <Suspense fallback={<Fallback h={260} />}>
          <ActivityCard />
        </Suspense>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
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
