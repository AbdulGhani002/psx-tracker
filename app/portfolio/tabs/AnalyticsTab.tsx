import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { Heatmap, MonthlyBars } from "@/components/charts/Heatmap";
import { DrawdownChart, DailyBars } from "@/components/charts/SmallCharts";
import { CompareChart } from "@/components/charts/CompareChart";
import { Sunburst } from "@/components/charts/Sunburst";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { getPerformance, getToday, getYields } from "@/lib/analytics/dashboard";
import { getRisk } from "@/lib/analytics/risk";
import { getPortfolioSummary, getAttribution } from "@/lib/data";
import { fmtRs, fmtSignedRs, fmtSignedPct, fmtDate, fmtPct } from "@/lib/format";
import type { PortfolioSearch } from "../page";

// Analytics in Zar's four views. Charts first, figures beside them, and no
// paragraphs: a label names each panel and the numbers do the talking.

const VIEWS = [
  { key: "returns", label: "Returns" },
  { key: "profitability", label: "Profitability" },
  { key: "diversification", label: "Diversification" },
  { key: "report", label: "Report" },
] as const;
const RANGES = ["3M", "1Y", "3Y", "ALL"];
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const toneOf = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");

function corrShade(c: number): string {
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `color-mix(in srgb, #3b82f6 ${Math.round(8 + a * 60)}%, white)` : `color-mix(in srgb, #dc2626 ${Math.round(8 + a * 60)}%, white)`;
}

export async function AnalyticsTab({ search }: { search: PortfolioSearch }) {
  const view = VIEWS.find((v) => v.key === search?.view)?.key ?? "returns";
  const range = RANGES.includes(search?.range ?? "") ? (search!.range as string) : "1Y";
  const href = (v: string, r = range) => `/portfolio?tab=analytics&view=${v}&range=${r}`;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="tabs !border-0">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href(v.key)} data-active={view === v.key}>{v.label}</Link>
          ))}
        </div>
        {view !== "diversification" && (
          <div className="seg">
            {RANGES.map((r) => (
              <Link key={r} href={href(view, r)} data-active={range === r}>{r}</Link>
            ))}
          </div>
        )}
      </div>
      {view === "returns" && <Returns range={range} />}
      {view === "profitability" && <Profitability range={range} />}
      {view === "diversification" && <Diversification />}
      {view === "report" && <Report range={range} />}
    </div>
  );
}

async function Returns({ range }: { range: string }) {
  const [perf, summary] = await Promise.all([getPerformance(range).catch(() => null), getPortfolioSummary()]);
  const s = perf?.summary ?? null;
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label={`Time-weighted return (${range})`} value={s ? fmtSignedPct(s.twrPct / 100, 2) : "–"} tone={s ? (s.twrPct >= 0 ? "positive" : "negative") : "muted"} delta={s?.benchPct != null ? `KSE ${fmtSignedPct(s.benchPct / 100, 1)}` : undefined} deltaTone="muted" />
        <StatCard label="Money-weighted (XIRR)" value={summary.xirr != null ? fmtSignedPct(summary.xirr, 2) : "–"} tone={summary.xirr == null ? "muted" : summary.xirr >= 0 ? "positive" : "negative"} />
        <StatCard label="Annualised (CAGR)" value={s?.cagrPct != null ? fmtSignedPct(s.cagrPct / 100, 2) : "–"} delta={s?.volPct != null ? `vol ${s.volPct.toFixed(1)}%` : undefined} deltaTone="muted" />
        <StatCard label="Max drawdown" value={s ? `${s.maxDrawdownPct.toFixed(1)}%` : "–"} tone="negative" delta={s?.sharpe != null ? `Sharpe ${s.sharpe.toFixed(2)}` : undefined} deltaTone="muted" />
      </div>
      <Card className="mt-3" title="Portfolio against the markets">
        <CompareChart initialRange={range} />
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2">
          <Card title="Monthly returns" action={<Legend items={[["Portfolio up", "var(--teal)"], ["Portfolio down", "var(--negative)"], ["KSE-100", "#f59e0b"]]} />}>
            {perf ? <MonthlyBars a={perf.monthly} b={perf.monthlyBench} months={range === "3M" ? 4 : range === "1Y" ? 13 : range === "3Y" ? 36 : 60} /> : <Empty />}
          </Card>
        </div>
        <Card title="Drawdown" action={perf ? <span className="pill" data-tone="negative">{perf.drawdown.current >= -0.0005 ? "At a high" : `${(perf.drawdown.current * 100).toFixed(1)}% now`}</span> : undefined}>
          {perf ? <DrawdownChart series={perf.drawdown.series} /> : <Empty />}
        </Card>
      </div>
      {perf && (
        <>
          <Card className="mt-3" title="Portfolio, month by month"><Heatmap table={perf.monthly} /></Card>
          <Card className="mt-3" title="KSE-100, month by month"><Heatmap table={perf.monthlyBench} /></Card>
        </>
      )}
    </div>
  );
}

async function Profitability({ range }: { range: string }) {
  const [perf, summary, today, attr, yields] = await Promise.all([getPerformance(range).catch(() => null), getPortfolioSummary(), getToday(), getAttribution(30).catch(() => null), getYields().catch(() => null)]);
  const held = summary.positions.filter((p) => p.shares > 0).sort((a, b) => b.marketValue - a.marketValue);
  const byName = new Map(today.names.map((n) => [n.symbol, n]));
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const maxAbs = Math.max(1, ...held.map((p) => Math.abs(p.totalReturn)));
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Total return" value={fmtSignedRs(totalReturn)} tone={totalReturn >= 0 ? "positive" : "negative"} delta={summary.totalCost > 0 ? fmtSignedPct(totalReturn / summary.totalCost, 1) : undefined} deltaTone={totalReturn >= 0 ? "positive" : "negative"} />
        <StatCard label="Unrealized" value={fmtSignedRs(summary.unrealizedPL)} tone={summary.unrealizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Realized" value={fmtSignedRs(summary.realizedPL)} tone={summary.realizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Dividends" value={fmtRs(summary.dividendsTotal)} delta={yields ? `${yields.portfolioYieldPct.toFixed(2)}% yield` : undefined} deltaTone="muted" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2">
          <Card title="Daily profit" action={<span className="text-[12px] text-muted">Last 40 sessions</span>}>
            {perf && perf.daily.length ? <DailyBars days={perf.daily.slice(-40)} /> : <Empty />}
          </Card>
        </div>
        <Card title="Profit by name" action={<span className="text-[12px] text-muted">Total return</span>}>
          <div className="space-y-2">
            {held.slice(0, 10).map((p) => (
              <div key={p.symbol} className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[12px]">
                <span className="font-semibold">{p.symbol}</span>
                <div className="relative h-2 rounded-full" style={{ background: "var(--surface-2)" }}>
                  <div className="absolute top-0 h-full rounded-full" style={{ left: p.totalReturn >= 0 ? "50%" : `${50 - (Math.abs(p.totalReturn) / maxAbs) * 50}%`, width: `${(Math.abs(p.totalReturn) / maxAbs) * 50}%`, background: toneOf(p.totalReturn) }} />
                  <div className="absolute top-[-2px] left-1/2 w-px h-3" style={{ background: "var(--rule-strong)" }} />
                </div>
                <span className="mono-num" style={{ color: toneOf(p.totalReturn) }}>{fmtSignedRs(p.totalReturn)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {attr && attr.contributions.length > 0 && (
        <Card className="mt-3" title="What moved it in the last 30 days" action={<span className="mono-num text-[13px] font-semibold" style={{ color: toneOf(attr.totalChangePkr) }}>{fmtSignedRs(attr.totalChangePkr)}</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
            {attr.contributions.slice(0, 10).map((c) => {
              const max = Math.max(...attr.contributions.map((r) => Math.abs(r.changePkr)), 1);
              return (
                <div key={c.symbol} className="grid grid-cols-[70px_1fr_auto] items-center gap-3 text-[12.5px]">
                  <span className="font-semibold">{c.symbol}</span>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}><div className="h-full rounded-full" style={{ width: `${(Math.abs(c.changePkr) / max) * 100}%`, background: toneOf(c.changePkr) }} /></div>
                  <span className="mono-num" style={{ color: toneOf(c.changePkr) }}>{fmtSignedRs(c.changePkr)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <Card className="mt-3" title="Positions">
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr><th>Name</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Price</th><th className="text-right">Today</th><th className="text-right">Value</th><th className="text-right">Unrealised</th><th className="text-right">Dividends</th><th className="text-right">Total return</th></tr>
            </thead>
            <tbody>
              {held.map((p) => {
                const d = byName.get(p.symbol);
                return (
                  <tr key={p.symbol}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <CompanyMark symbol={p.symbol} sector={p.sector} size="sm" />
                        <div><Link href={`/holdings/${p.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{p.symbol}</Link><div className="text-[11px] text-muted">{p.name}</div></div>
                      </div>
                    </td>
                    <td className="text-right mono-num">{p.shares.toLocaleString()}</td>
                    <td className="text-right mono-num">{p.avgCost.toFixed(2)}</td>
                    <td className="text-right mono-num">{p.priceKnown ? p.currentPrice.toFixed(2) : "–"}</td>
                    <td className="text-right mono-num" style={{ color: d ? toneOf(d.changePct) : undefined }}>{d ? pct(d.changePct, 2) : "–"}</td>
                    <td className="text-right mono-num">{fmtRs(p.marketValue)}</td>
                    <td className="text-right mono-num" style={{ color: toneOf(p.unrealizedPL) }}>{fmtSignedRs(p.unrealizedPL)}<div className="text-[11px] opacity-80">{fmtSignedPct(p.unrealizedPct, 1)}</div></td>
                    <td className="text-right mono-num">{fmtRs(p.dividendsReceived)}</td>
                    <td className="text-right mono-num" style={{ color: toneOf(p.totalReturn) }}>{fmtSignedRs(p.totalReturn)}<div className="text-[11px] opacity-80">{fmtSignedPct(p.totalReturnPct, 1)}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function Diversification() {
  const [summary, risk, today] = await Promise.all([getPortfolioSummary(), getRisk().catch(() => null), getToday()]);
  const held = summary.positions.filter((p) => p.shares > 0).sort((a, b) => b.marketValue - a.marketValue);
  const p = risk?.portfolio;
  const maxContribution = risk ? Math.max(...risk.names.map((n) => Math.abs(n.riskContributionPct)), 1) : 1;
  const leaves = held.map((h) => ({ symbol: h.symbol, sector: h.sector || "Other", value: h.marketValue, pct: h.unrealizedPct }));
  const sectorSlices = summary.sectorBreakdown.map((s) => ({ label: s.sector || "Other", value: s.value }));
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Positions" value={String(held.length)} delta={p ? `${p.effectiveNames.toFixed(1)} effective` : undefined} deltaTone="muted" />
        <StatCard label="Sectors" value={String(sectorSlices.filter((s) => s.value > 0).length)} delta={p ? `top 3 ${p.top3WeightPct.toFixed(0)}%` : undefined} deltaTone="muted" />
        <StatCard label="Value at risk, 1 day" value={p ? fmtRs(p.var95Rs) : "–"} tone="negative" delta={p ? "95%" : undefined} deltaTone="muted" />
        <StatCard label="Volatility, 1 year" value={p ? `${p.vol1yPct.toFixed(1)}%` : "–"} delta={p?.beta != null ? `beta ${p.beta.toFixed(2)}` : undefined} deltaTone="muted" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <Card title="Holdings" action={<span className="text-[12px] text-muted">By sector and name</span>}>
          <Sunburst leaves={leaves} centreValue={pct(today.profitPct, 2)} centreLabel="Today" centreTone={toneOf(today.profitPct)} />
        </Card>
        <Card title="Sectors">
          <AllocationDonut slices={sectorSlices} maxSlices={8} centerValue={String(sectorSlices.length)} centerLabel="sectors" />
        </Card>
        <Card title="Names">
          <AllocationDonut slices={held.map((x) => ({ label: x.symbol, value: x.marketValue }))} maxSlices={8} centerValue={String(held.length)} centerLabel="names" />
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <Card title="Weight by sector">
          <div className="space-y-2.5">
            {summary.sectorBreakdown.map((s) => (
              <div key={s.sector} className="text-[12.5px]">
                <div className="flex justify-between"><span>{s.sector || "Other"}</span><span className="mono-num">{s.percent.toFixed(1)}%</span></div>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)] mt-1"><div className="h-full rounded-full" style={{ width: `${s.percent}%`, background: "var(--teal)" }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <div className="xl:col-span-2">
          {risk ? (
            <Card title="Where the risk sits" action={<span className="text-[12px] text-muted">Share of variance against weight</span>}>
              <div className="overflow-x-auto -mx-2">
                <table className="table-zar">
                  <thead>
                    <tr><th>Name</th><th className="text-right">Weight</th><th className="text-right">Risk share</th><th></th><th className="text-right">Vol 1y</th><th className="text-right">Beta</th><th className="text-right">Max DD</th><th className="text-right">Days to exit</th></tr>
                  </thead>
                  <tbody>
                    {risk.names.map((n) => (
                      <tr key={n.symbol}>
                        <td><Link href={`/holdings/${n.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{n.symbol}</Link></td>
                        <td className="text-right mono-num">{n.weightPct.toFixed(1)}%</td>
                        <td className="text-right mono-num" style={{ color: n.riskContributionPct > n.weightPct + 3 ? "var(--negative)" : undefined }}>{n.riskContributionPct.toFixed(1)}%</td>
                        <td style={{ minWidth: 90 }}><div className="h-1.5 rounded-full bg-[var(--surface-2)]"><div className="h-full rounded-full" style={{ width: `${(Math.abs(n.riskContributionPct) / maxContribution) * 100}%`, background: "var(--amber)" }} /></div></td>
                        <td className="text-right mono-num">{n.vol1yPct.toFixed(0)}%</td>
                        <td className="text-right mono-num">{n.beta != null ? n.beta.toFixed(2) : "–"}</td>
                        <td className="text-right mono-num" style={{ color: "var(--negative)" }}>{n.maxDrawdown1yPct.toFixed(0)}%</td>
                        <td className="text-right mono-num">{n.daysToExit != null ? (n.daysToExit < 1 ? "<1" : n.daysToExit.toFixed(1)) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card title="Risk"><div className="text-[12px] text-muted">Needs a year of closes for the held names.</div></Card>
          )}
        </div>
      </div>
      {risk && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
          <Card title="Correlations" action={<Legend items={[["Move together", "#3b82f6"], ["Move apart", "#dc2626"]]} />}>
            <div className="overflow-x-auto">
              <table className="text-[11px]" style={{ borderCollapse: "separate", borderSpacing: 2 }}>
                <thead>
                  <tr><th></th>{risk.correlations.symbols.map((s) => <th key={s} className="font-medium text-muted px-1 pb-1" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{s}</th>)}</tr>
                </thead>
                <tbody>
                  {risk.correlations.symbols.map((s, i) => (
                    <tr key={s}>
                      <td className="font-medium pr-2 text-muted">{s}</td>
                      {risk.correlations.matrix[i].map((c, j) => (
                        <td key={j} className="mono-num text-center rounded" style={{ background: i === j ? "var(--surface-2)" : corrShade(c), width: 32, height: 24 }} title={`${s} × ${risk.correlations.symbols[j]}: ${c.toFixed(2)}`}>
                          {i === j ? "" : c.toFixed(2).replace("0.", ".")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Stress tests">
            <table className="table-zar">
              <thead><tr><th>Scenario</th><th className="text-right">Index</th><th className="text-right">Book</th></tr></thead>
              <tbody>
                {risk.scenarios.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td className="text-right mono-num">{s.indexPct ? pct(s.indexPct) : "–"}</td>
                    <td className="text-right mono-num" style={{ color: toneOf(s.portfolioRs) }}>{fmtSignedRs(s.portfolioRs)} <span className="text-[11px] opacity-80">({pct(s.portfolioPct)})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

async function Report({ range }: { range: string }) {
  const [perf, summary, yields] = await Promise.all([getPerformance(range).catch(() => null), getPortfolioSummary(), getYields().catch(() => null)]);
  const s = perf?.summary ?? null;
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const Row = ({ k, v, tone }: { k: string; v: string; tone?: string }) => (
    <tr><td className="text-muted">{k}</td><td className="text-right mono-num font-medium" style={{ color: tone }}>{v}</td></tr>
  );
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <Card title="Return results" action={s ? <span className="text-[12px] text-muted">{fmtDate(s.from)} to {fmtDate(s.to)}</span> : undefined}>
        <table className="table-zar">
          <tbody>
            <Row k="Time-weighted return (TWR)" v={s ? fmtSignedPct(s.twrPct / 100, 2) : "–"} tone={s ? toneOf(s.twrPct) : undefined} />
            <Row k="KSE-100 over the same days" v={s?.benchPct != null ? fmtSignedPct(s.benchPct / 100, 2) : "–"} tone={s?.benchPct != null ? toneOf(s.benchPct) : undefined} />
            <Row k="Money-weighted return (XIRR)" v={summary.xirr != null ? fmtSignedPct(summary.xirr, 2) : "–"} tone={summary.xirr != null ? toneOf(summary.xirr) : undefined} />
            <Row k="Annualised (CAGR)" v={s?.cagrPct != null ? fmtSignedPct(s.cagrPct / 100, 2) : "–"} />
            <Row k="Volatility, annualised" v={s?.volPct != null ? `${s.volPct.toFixed(1)}%` : "–"} />
            <Row k="Beta to KSE-100" v={s?.beta != null ? s.beta.toFixed(2) : "–"} />
            <Row k="Sharpe ratio" v={s?.sharpe != null ? s.sharpe.toFixed(2) : "–"} />
            <Row k="Max drawdown" v={s ? `${s.maxDrawdownPct.toFixed(1)}%` : "–"} tone="var(--negative)" />
            <Row k="Sessions up" v={s ? `${Math.round(s.upDaysShare * 100)}%` : "–"} />
          </tbody>
        </table>
      </Card>
      <Card title="Investment activity" action={<span className="text-[12px] text-muted">At the last close</span>}>
        <table className="table-zar">
          <tbody>
            <Row k="Market value" v={fmtRs(summary.totalValue)} />
            <Row k="Invested (cost of holdings)" v={fmtRs(summary.totalCost)} />
            <Row k="Unrealised gain/loss" v={fmtSignedRs(summary.unrealizedPL)} tone={toneOf(summary.unrealizedPL)} />
            <Row k="Realised gain/loss" v={fmtSignedRs(summary.realizedPL)} tone={toneOf(summary.realizedPL)} />
            <Row k="Dividends received" v={fmtRs(summary.dividendsTotal)} />
            <Row k={`Dividends, ${summary.taxYearLabel}`} v={fmtRs(summary.dividendsYTD)} />
            <Row k="Total return" v={fmtSignedRs(totalReturn)} tone={toneOf(totalReturn)} />
            <Row k="Total return on cost" v={summary.totalCost > 0 ? fmtSignedPct(totalReturn / summary.totalCost, 2) : "–"} tone={toneOf(totalReturn)} />
            <Row k="Dividend yield on value" v={yields ? `${yields.portfolioYieldPct.toFixed(2)}%` : "–"} />
            <Row k="Dividend yield on cost" v={yields ? `${yields.yieldOnCostPct.toFixed(2)}%` : "–"} />
            <Row k="Largest position" v={summary.positions.length ? `${[...summary.positions].sort((a, b) => b.marketValue - a.marketValue)[0].symbol} ${fmtPct(Math.max(...summary.positions.map((p) => p.currentPercent)) / 100, 1)}` : "–"} />
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <span className="flex items-center gap-3 text-[11px] text-muted">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{label}</span>
      ))}
    </span>
  );
}

function Empty() {
  return <div className="text-[12px] text-muted">No series yet.</div>;
}
