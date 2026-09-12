import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { Heatmap, MonthlyBars } from "@/components/charts/Heatmap";
import { DrawdownChart, DailyBars } from "@/components/charts/SmallCharts";
import { getPerformance, getToday, getYields } from "@/lib/analytics/dashboard";
import { getPortfolioSummary } from "@/lib/data";
import { fmtRs, fmtSignedRs, fmtSignedPct, fmtDate, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const RANGES = ["3M", "1Y", "3Y", "ALL"];

export default async function AnalyticsPage({ searchParams }: { searchParams?: { range?: string } }) {
  const range = RANGES.includes(searchParams?.range ?? "") ? (searchParams!.range as string) : "1Y";
  const [perf, summary, today, yields] = await Promise.all([getPerformance(range).catch(() => null), getPortfolioSummary(), getToday(), getYields().catch(() => null)]);
  const s = perf?.summary ?? null;
  const held = summary.positions.filter((p) => p.shares > 0).sort((a, b) => b.marketValue - a.marketValue);
  const byName = new Map(today.names.map((n) => [n.symbol, n]));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">Analytics</h1>
          <div className="text-[12px] text-muted mt-0.5">Time-weighted returns against the KSE-100, drawdowns, the daily profit, and what each name yields.</div>
        </div>
        <div className="seg">
          {RANGES.map((r) => (
            <Link key={r} href={`/analytics?range=${r}`} data-active={range === r} className="px-2.5 py-1 rounded-lg text-[12px] font-medium" style={{ background: range === r ? "var(--surface)" : "transparent", color: range === r ? "var(--ink)" : "var(--muted)" }}>
              {r}
            </Link>
          ))}
        </div>
      </div>

      <StatRow>
        <Stat label={`Time-weighted return · ${range}`} value={s ? fmtSignedPct(s.twrPct / 100, 1) : "–"} size="lg" tone={s ? (s.twrPct >= 0 ? "positive" : "negative") : "muted"} hint={s?.benchPct != null ? `KSE-100 ${fmtSignedPct(s.benchPct / 100, 1)} over the same days` : "How the holdings performed, deposits taken out"} />
        <Stat label="Money-weighted (XIRR)" value={summary.xirr != null ? fmtSignedPct(summary.xirr, 1) : "–"} size="lg" tone={summary.xirr == null ? "muted" : summary.xirr >= 0 ? "positive" : "negative"} hint="Your own return, with the timing of your money" />
        <Stat label="Annualised (CAGR)" value={s?.cagrPct != null ? fmtSignedPct(s.cagrPct / 100, 1) : "–"} size="lg" hint={s?.volPct != null ? `Volatility ${s.volPct.toFixed(1)}% a year` : undefined} />
        <Stat label="Max drawdown" value={s ? `${s.maxDrawdownPct.toFixed(1)}%` : "–"} size="lg" tone="negative" hint={perf?.drawdown.troughDate ? `Peak ${fmtDate(perf.drawdown.peakDate)}, trough ${fmtDate(perf.drawdown.troughDate)}${perf.drawdown.recoveredOn ? `, recovered ${fmtDate(perf.drawdown.recoveredOn)}` : ", not yet recovered"}` : undefined} />
        <Stat label="Beta · Sharpe" value={s?.beta != null ? `${s.beta.toFixed(2)} · ${s.sharpe != null ? s.sharpe.toFixed(2) : "–"}` : "–"} size="lg" hint={s ? `${Math.round(s.upDaysShare * 100)}% of sessions up` : undefined} />
      </StatRow>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          <Card title="Monthly returns" eyebrow="Portfolio (time-weighted) against the KSE-100">
            {perf ? <MonthlyBars a={perf.monthly} b={perf.monthlyBench} months={range === "3M" ? 4 : range === "1Y" ? 13 : range === "3Y" ? 36 : 60} /> : <div className="text-[12px] text-muted">No series yet.</div>}
          </Card>
        </div>
        <Card title="Drawdown" eyebrow="How far under its own high the portfolio sat">
          {perf ? <DrawdownChart series={perf.drawdown.series} /> : <div className="text-[12px] text-muted">No series yet.</div>}
          {perf && (
            <div className="text-[12px] text-muted mt-2">
              Now {perf.drawdown.current >= -0.0005 ? "at a high" : `${(perf.drawdown.current * 100).toFixed(1)}% under the high`}.
            </div>
          )}
        </Card>
      </div>

      {perf && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          <Card title="Portfolio, month by month" eyebrow="Time-weighted">
            <Heatmap table={perf.monthly} />
          </Card>
          <Card title="KSE-100, month by month" eyebrow="The same months">
            <Heatmap table={perf.monthlyBench} />
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <div className="xl:col-span-2">
          <Card title="Daily profit" eyebrow="Yesterday's holdings at each day's closes; a buy made that day does not count" action={<span className="text-[12px] text-muted">last 40 sessions</span>}>
            {perf && perf.daily.length ? (
              <>
                <DailyBars days={perf.daily.slice(-40)} />
                <div className="overflow-x-auto mt-4">
                  <table className="table-zar">
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th className="text-right">Return</th>
                        <th className="text-right">Profit</th>
                        <th className="text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...perf.daily].slice(-10).reverse().map((d) => (
                        <tr key={d.date}>
                          <td>{fmtDate(d.date)}</td>
                          <td className="text-right font-mono mono-num" style={{ color: d.ret >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedPct(d.ret, 2)}</td>
                          <td className="text-right font-mono mono-num" style={{ color: d.profit >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(d.profit)}</td>
                          <td className="text-right font-mono mono-num">{fmtRs(d.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="text-[12px] text-muted">No series yet.</div>
            )}
          </Card>
        </div>
        <Card title="Holdings" eyebrow="By market value">
          <AllocationDonut slices={held.map((p) => ({ label: p.symbol, value: p.marketValue }))} maxSlices={8} centerValue={String(held.length)} centerLabel="names" />
        </Card>
      </div>

      <Card className="mt-4" title="Active holdings" eyebrow="Priced at the last close" action={<Link href="/holdings" className="text-[12px] link-underline">Holdings</Link>}>
        <div className="overflow-x-auto">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Name</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Avg cost</th>
                <th className="text-right">Price</th>
                <th className="text-right">Today</th>
                <th className="text-right">Value</th>
                <th className="text-right">Weight</th>
                <th className="text-right">Unrealised</th>
                <th className="text-right">Total return</th>
                <th className="text-right">52w range</th>
              </tr>
            </thead>
            <tbody>
              {held.map((p) => {
                const d = byName.get(p.symbol);
                const pos52 = d && d.high52 > d.low52 ? ((d.price - d.low52) / (d.high52 - d.low52)) * 100 : null;
                return (
                  <tr key={p.symbol}>
                    <td>
                      <Link href={`/holdings/${p.symbol}`} className="font-medium hover:text-[var(--accent-deep)]">{p.symbol}</Link>
                      <div className="text-[11px] text-muted">{p.name}</div>
                    </td>
                    <td className="text-right font-mono mono-num">{p.shares.toLocaleString()}</td>
                    <td className="text-right font-mono mono-num">{p.avgCost.toFixed(2)}</td>
                    <td className="text-right font-mono mono-num">{p.priceKnown ? p.currentPrice.toFixed(2) : "–"}</td>
                    <td className="text-right font-mono mono-num" style={{ color: d ? (d.changePct >= 0 ? "var(--positive)" : "var(--negative)") : undefined }}>{d ? `${d.changePct >= 0 ? "+" : ""}${d.changePct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right font-mono mono-num">{fmtRs(p.marketValue)}</td>
                    <td className="text-right font-mono mono-num">{fmtPct(p.currentPercent / 100, 1)}</td>
                    <td className="text-right font-mono mono-num" style={{ color: p.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>
                      {fmtSignedRs(p.unrealizedPL)} <span className="text-muted">({fmtSignedPct(p.unrealizedPct, 1)})</span>
                    </td>
                    <td className="text-right font-mono mono-num" style={{ color: p.totalReturn >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedPct(p.totalReturnPct, 1)}</td>
                    <td className="text-right">
                      {d ? (
                        <div className="inline-flex items-center gap-2 text-[11px] text-muted">
                          <span className="font-mono">{d.low52.toFixed(0)}</span>
                          <span className="relative inline-block w-16 h-1.5 rounded-full bg-[var(--surface-2)]">
                            <span className="absolute top-[-3px] w-2.5 h-2.5 rounded-full" style={{ left: `calc(${pos52 ?? 0}% - 5px)`, background: "var(--accent)" }} />
                          </span>
                          <span className="font-mono">{d.high52.toFixed(0)}</span>
                        </div>
                      ) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {yields && yields.rows.length > 0 && (
        <Card className="mt-4" title="Dividend yields" eyebrow="Last twelve months of payouts against today's price and against your cost" action={<Link href="/dividends" className="text-[12px] link-underline">Payouts</Link>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-[12px]">
            <div><div className="text-muted">Received, last 12 months</div><div className="font-mono mono-num text-[16px] font-semibold">{fmtRs(yields.ttmTotal)}</div></div>
            <div><div className="text-muted">Yield on today's value</div><div className="font-mono mono-num text-[16px] font-semibold">{yields.portfolioYieldPct.toFixed(2)}%</div></div>
            <div><div className="text-muted">Yield on cost</div><div className="font-mono mono-num text-[16px] font-semibold">{yields.yieldOnCostPct.toFixed(2)}%</div></div>
            <div><div className="text-muted">Per day, on average</div><div className="font-mono mono-num text-[16px] font-semibold">{fmtRs(yields.ttmTotal / 365)}</div></div>
          </div>
          <div className="overflow-x-auto">
            <table className="table-zar">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">12m per share</th>
                  <th className="text-right">12m received</th>
                  <th className="text-right">Yield on price</th>
                  <th className="text-right">Yield on cost</th>
                  <th className="text-right">All time</th>
                  <th className="text-right">Last paid</th>
                </tr>
              </thead>
              <tbody>
                {yields.rows.map((r) => (
                  <tr key={r.symbol}>
                    <td><span className="font-medium">{r.symbol}</span> <span className="text-[11px] text-muted">{r.name}</span></td>
                    <td className="text-right font-mono mono-num">{r.ttmPerShare ? r.ttmPerShare.toFixed(2) : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.ttmDividends ? fmtRs(r.ttmDividends) : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.yieldOnPricePct ? `${r.yieldOnPricePct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.yieldOnCostPct ? `${r.yieldOnCostPct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right font-mono mono-num">{r.allTimeDividends ? fmtRs(r.allTimeDividends) : "–"}</td>
                    <td className="text-right text-muted">{r.lastPaid ? fmtDate(r.lastPaid) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
