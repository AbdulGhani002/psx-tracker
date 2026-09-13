import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { Heatmap, MonthlyBars } from "@/components/charts/Heatmap";
import { DrawdownChart, DailyBars } from "@/components/charts/SmallCharts";
import { PerformancePanel } from "@/components/charts/PerformancePanel";
import { getPerformance, getToday, getYields } from "@/lib/analytics/dashboard";
import { getRisk } from "@/lib/analytics/risk";
import { getPortfolioSummary, getAttribution } from "@/lib/data";
import { fmtRs, fmtSignedRs, fmtSignedPct, fmtDate } from "@/lib/format";
import type { PortfolioSearch } from "../page";

// Analytics, in Zar's four views: returns against the market, where the
// profit came from, how spread the book is, and a report of the figures.

const VIEWS = [
  { key: "returns", label: "Returns" },
  { key: "profitability", label: "Profitability" },
  { key: "diversification", label: "Diversification" },
  { key: "report", label: "Report" },
] as const;
const RANGES = ["3M", "1Y", "3Y", "ALL"];
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

function corrShade(c: number): string {
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `color-mix(in srgb, var(--blue) ${Math.round(8 + a * 60)}%, white)` : `color-mix(in srgb, var(--negative) ${Math.round(8 + a * 60)}%, white)`;
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
        <div className="seg">
          {RANGES.map((r) => (
            <Link key={r} href={href(view, r)} data-active={range === r}>{r}</Link>
          ))}
        </div>
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
        <StatCard label={`Time-weighted return, ${range}`} value={s ? fmtSignedPct(s.twrPct / 100, 2) : "–"} tone={s ? (s.twrPct >= 0 ? "positive" : "negative") : "muted"} hint={s?.benchPct != null ? `KSE-100 ${fmtSignedPct(s.benchPct / 100, 2)} over the same days` : undefined} />
        <StatCard label="Money-weighted (XIRR)" value={summary.xirr != null ? fmtSignedPct(summary.xirr, 2) : "–"} tone={summary.xirr == null ? "muted" : summary.xirr >= 0 ? "positive" : "negative"} hint="Your own return, with the timing of your money" />
        <StatCard label="Annualised (CAGR)" value={s?.cagrPct != null ? fmtSignedPct(s.cagrPct / 100, 2) : "–"} hint={s?.volPct != null ? `Volatility ${s.volPct.toFixed(1)}% a year` : undefined} />
        <StatCard label="Beta · Sharpe" value={s?.beta != null ? `${s.beta.toFixed(2)} · ${s.sharpe != null ? s.sharpe.toFixed(2) : "–"}` : "–"} hint={s ? `${Math.round(s.upDaysShare * 100)}% of sessions up` : undefined} />
      </div>
      <Card className="mt-3" title="Time-weighted return (TWR)" eyebrow="How your holdings performed without deposits and withdrawals changing the result, against the KSE-100">
        <PerformancePanel initialRange={range} />
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2">
          <Card title="Monthly returns" eyebrow="Portfolio against the KSE-100">
            {perf ? <MonthlyBars a={perf.monthly} b={perf.monthlyBench} months={range === "3M" ? 4 : range === "1Y" ? 13 : range === "3Y" ? 36 : 60} /> : <div className="text-[12px] text-muted">No series yet.</div>}
          </Card>
        </div>
        <Card title="Drawdown" eyebrow="How far under its own high the portfolio sat">
          {perf ? <DrawdownChart series={perf.drawdown.series} /> : <div className="text-[12px] text-muted">No series yet.</div>}
          {perf && <div className="text-[12px] text-muted mt-2">Now {perf.drawdown.current >= -0.0005 ? "at a high" : `${(perf.drawdown.current * 100).toFixed(1)}% under the high`}. Deepest {(perf.drawdown.max * 100).toFixed(1)}%{perf.drawdown.troughDate ? `, trough ${fmtDate(perf.drawdown.troughDate)}` : ""}.</div>}
        </Card>
      </div>
      {perf && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
          <Card title="Portfolio, month by month"><Heatmap table={perf.monthly} /></Card>
          <Card title="KSE-100, month by month"><Heatmap table={perf.monthlyBench} /></Card>
        </div>
      )}
    </div>
  );
}

async function Profitability({ range }: { range: string }) {
  const [perf, summary, today, attr, yields] = await Promise.all([getPerformance(range).catch(() => null), getPortfolioSummary(), getToday(), getAttribution(30).catch(() => null), getYields().catch(() => null)]);
  const held = summary.positions.filter((p) => p.shares > 0).sort((a, b) => b.marketValue - a.marketValue);
  const byName = new Map(today.names.map((n) => [n.symbol, n]));
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Total return" value={fmtSignedRs(totalReturn)} tone={totalReturn >= 0 ? "positive" : "negative"} hint={summary.totalCost > 0 ? `${fmtSignedPct(totalReturn / summary.totalCost, 2)} on cost` : undefined} />
        <StatCard label="Unrealized" value={fmtSignedRs(summary.unrealizedPL)} tone={summary.unrealizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Realized" value={fmtSignedRs(summary.realizedPL)} tone={summary.realizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Dividends" value={fmtRs(summary.dividendsTotal)} hint={yields ? `${yields.portfolioYieldPct.toFixed(2)}% yield on value, ${yields.yieldOnCostPct.toFixed(2)}% on cost` : undefined} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2">
          <Card title="Daily profit" eyebrow="Yesterday's holdings at each day's closes; a buy made that day does not count" action={<span className="text-[12px] text-muted">last 40 sessions</span>}>
            {perf && perf.daily.length ? <DailyBars days={perf.daily.slice(-40)} /> : <div className="text-[12px] text-muted">No series yet.</div>}
          </Card>
        </div>
        {attr && attr.contributions.length > 0 && (
          <Card title="What moved it" eyebrow="Last 30 days, price only" action={<span className="mono-num text-[13px] font-semibold" style={{ color: attr.totalChangePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(attr.totalChangePkr)}</span>}>
            <div className="space-y-2.5">
              {attr.contributions.slice(0, 8).map((c) => {
                const max = Math.max(...attr.contributions.map((r) => Math.abs(r.changePkr)), 1);
                return (
                  <div key={c.symbol} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-[12.5px]">
                    <span className="font-semibold">{c.symbol}</span>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}><div className="h-full rounded-full" style={{ width: `${(Math.abs(c.changePkr) / max) * 100}%`, background: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }} /></div>
                    <span className="mono-num" style={{ color: c.changePkr >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.changePkr)}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
      <Card className="mt-3" title="Profit by name" eyebrow="Each position's unrealised gain, dividends and total return">
        <div className="overflow-x-auto">
          <table className="table-zar">
            <thead>
              <tr><th>Name</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Price</th><th className="text-right">Today</th><th className="text-right">Value</th><th className="text-right">Unrealised</th><th className="text-right">Dividends</th><th className="text-right">Total return</th></tr>
            </thead>
            <tbody>
              {held.map((p) => {
                const d = byName.get(p.symbol);
                return (
                  <tr key={p.symbol}>
                    <td><Link href={`/holdings/${p.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{p.symbol}</Link><div className="text-[11px] text-muted">{p.name}</div></td>
                    <td className="text-right mono-num">{p.shares.toLocaleString()}</td>
                    <td className="text-right mono-num">{p.avgCost.toFixed(2)}</td>
                    <td className="text-right mono-num">{p.priceKnown ? p.currentPrice.toFixed(2) : "–"}</td>
                    <td className="text-right mono-num" style={{ color: d ? (d.changePct >= 0 ? "var(--positive)" : "var(--negative)") : undefined }}>{d ? pct(d.changePct, 2) : "–"}</td>
                    <td className="text-right mono-num">{fmtRs(p.marketValue)}</td>
                    <td className="text-right mono-num" style={{ color: p.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(p.unrealizedPL)} <span className="text-[11px] opacity-80">({fmtSignedPct(p.unrealizedPct, 1)})</span></td>
                    <td className="text-right mono-num">{fmtRs(p.dividendsReceived)}</td>
                    <td className="text-right mono-num" style={{ color: p.totalReturn >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(p.totalReturn)} <span className="text-[11px] opacity-80">({fmtSignedPct(p.totalReturnPct, 1)})</span></td>
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
  const [summary, risk] = await Promise.all([getPortfolioSummary(), getRisk().catch(() => null)]);
  const held = summary.positions.filter((p) => p.shares > 0).sort((a, b) => b.marketValue - a.marketValue);
  const p = risk?.portfolio;
  const maxContribution = risk ? Math.max(...risk.names.map((n) => Math.abs(n.riskContributionPct)), 1) : 1;
  return (
    <div>
      {p && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
          <StatCard label="Value at risk, 1 day (95%)" value={fmtRs(p.var95Rs)} tone="negative" hint={`99%: ${fmtRs(p.var99Rs)} · shortfall beyond 95%: ${fmtRs(p.es95Rs)}`} />
          <StatCard label="Value at risk, 20 sessions" value={fmtRs(p.var95_20dRs)} tone="negative" hint={`${((p.var95_20dRs / risk!.value) * 100).toFixed(1)}% of ${fmtRs(risk!.value)}`} />
          <StatCard label="Volatility, annualised" value={`${p.vol1yPct.toFixed(1)}%`} hint={p.beta != null ? `Beta to KSE-100 ${p.beta.toFixed(2)}` : undefined} />
          <StatCard label="Concentration" value={`${p.effectiveNames.toFixed(1)} names`} hint={`Top three ${p.top3WeightPct.toFixed(0)}% of the book`} />
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <Card title="By name" eyebrow="Market value">
          <AllocationDonut slices={held.map((x) => ({ label: x.symbol, value: x.marketValue }))} maxSlices={8} centerValue={String(held.length)} centerLabel="names" />
        </Card>
        <Card title="By sector" eyebrow="Weight of the book">
          <div className="space-y-2.5">
            {summary.sectorBreakdown.map((s) => (
              <div key={s.sector} className="text-[12.5px]">
                <div className="flex justify-between"><span>{s.sector || "Unclassified"}</span><span className="mono-num">{s.percent.toFixed(1)}%</span></div>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)] mt-1"><div className="h-full rounded-full" style={{ width: `${s.percent}%`, background: "var(--teal)" }} /></div>
              </div>
            ))}
          </div>
          {p && <div className="text-[11px] text-muted mt-3">Herfindahl {p.hhi.toFixed(3)}: the book behaves like {p.effectiveNames.toFixed(1)} equal positions.</div>}
        </Card>
        {risk && (
          <Card title="Correlations" eyebrow="Daily returns over the last year; blue moves together, red apart">
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
        )}
      </div>
      {risk && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
          <div className="xl:col-span-2">
            <Card title="Where the risk sits" eyebrow="Each name's share of the book's variance against its share of its value">
              <div className="overflow-x-auto">
                <table className="table-zar">
                  <thead>
                    <tr><th>Name</th><th className="text-right">Weight</th><th className="text-right">Risk share</th><th></th><th className="text-right">Vol 1y</th><th className="text-right">Beta</th><th className="text-right">Max DD 1y</th><th className="text-right">Days to exit</th></tr>
                  </thead>
                  <tbody>
                    {risk.names.map((n) => (
                      <tr key={n.symbol}>
                        <td><Link href={`/holdings/${n.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{n.symbol}</Link><div className="text-[11px] text-muted">{n.sector}</div></td>
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
          </div>
          <Card title="Stress tests" eyebrow="What the book loses when the index is shocked">
            <table className="table-zar">
              <thead><tr><th>Scenario</th><th className="text-right">Index</th><th className="text-right">Book</th></tr></thead>
              <tbody>
                {risk.scenarios.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}<div className="text-[11px] text-muted">{s.note}</div></td>
                    <td className="text-right mono-num">{s.indexPct ? pct(s.indexPct) : "–"}</td>
                    <td className="text-right mono-num" style={{ color: s.portfolioRs >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(s.portfolioRs)}<div className="text-[11px] opacity-80">{pct(s.portfolioPct)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {!risk && <Card className="mt-3"><div className="text-[13px] text-muted">Risk needs priced holdings and a year of closes in the bars cache.</div></Card>}
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
  const t = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <Card title="Return results" eyebrow={s ? `${fmtDate(s.from)} to ${fmtDate(s.to)}` : range}>
        <table className="table-zar">
          <tbody>
            <Row k="Time-weighted return (TWR)" v={s ? fmtSignedPct(s.twrPct / 100, 2) : "–"} tone={s ? t(s.twrPct) : undefined} />
            <Row k="KSE-100 over the same days" v={s?.benchPct != null ? fmtSignedPct(s.benchPct / 100, 2) : "–"} tone={s?.benchPct != null ? t(s.benchPct) : undefined} />
            <Row k="Money-weighted return (XIRR)" v={summary.xirr != null ? fmtSignedPct(summary.xirr, 2) : "–"} tone={summary.xirr != null ? t(summary.xirr) : undefined} />
            <Row k="Annualised (CAGR)" v={s?.cagrPct != null ? fmtSignedPct(s.cagrPct / 100, 2) : "–"} />
            <Row k="Volatility, annualised" v={s?.volPct != null ? `${s.volPct.toFixed(1)}%` : "–"} />
            <Row k="Beta to KSE-100" v={s?.beta != null ? s.beta.toFixed(2) : "–"} />
            <Row k="Sharpe ratio" v={s?.sharpe != null ? s.sharpe.toFixed(2) : "–"} />
            <Row k="Max drawdown" v={s ? `${s.maxDrawdownPct.toFixed(1)}%` : "–"} tone="var(--negative)" />
            <Row k="Sessions up" v={s ? `${Math.round(s.upDaysShare * 100)}%` : "–"} />
          </tbody>
        </table>
      </Card>
      <Card title="Investment activity" eyebrow="At the last close">
        <table className="table-zar">
          <tbody>
            <Row k="Market value" v={fmtRs(summary.totalValue)} />
            <Row k="Invested (cost of holdings)" v={fmtRs(summary.totalCost)} />
            <Row k="Unrealised gain/loss" v={fmtSignedRs(summary.unrealizedPL)} tone={t(summary.unrealizedPL)} />
            <Row k="Realised gain/loss" v={fmtSignedRs(summary.realizedPL)} tone={t(summary.realizedPL)} />
            <Row k="Dividends received" v={fmtRs(summary.dividendsTotal)} />
            <Row k={`Dividends, ${summary.taxYearLabel}`} v={fmtRs(summary.dividendsYTD)} />
            <Row k="Total return" v={fmtSignedRs(totalReturn)} tone={t(totalReturn)} />
            <Row k="Total return on cost" v={summary.totalCost > 0 ? fmtSignedPct(totalReturn / summary.totalCost, 2) : "–"} tone={t(totalReturn)} />
            <Row k="Dividend yield on value" v={yields ? `${yields.portfolioYieldPct.toFixed(2)}%` : "–"} />
            <Row k="Dividend yield on cost" v={yields ? `${yields.yieldOnCostPct.toFixed(2)}%` : "–"} />
          </tbody>
        </table>
      </Card>
    </div>
  );
}

