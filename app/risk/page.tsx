import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { getRisk } from "@/lib/analytics/risk";
import { fmtRs, fmtSignedRs, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

function corrShade(c: number): string {
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `color-mix(in srgb, var(--blue) ${Math.round(10 + a * 70)}%, transparent)` : `color-mix(in srgb, var(--negative) ${Math.round(10 + a * 70)}%, transparent)`;
}

export default async function RiskPage() {
  const risk = await getRisk().catch(() => null);
  if (!risk) {
    return (
      <div>
        <h1 className="text-[22px] font-semibold">Risk</h1>
        <Card className="mt-4"><div className="text-[13px] text-muted">Nothing to measure yet: risk needs priced holdings and a year of closes in the bars cache.</div></Card>
      </div>
    );
  }
  const p = risk.portfolio;
  const maxContribution = Math.max(...risk.names.map((n) => Math.abs(n.riskContributionPct)), 1);

  return (
    <div>
      <div>
        <h1 className="text-[22px] font-semibold leading-tight">Risk</h1>
        <div className="text-[12px] text-muted mt-0.5">The book as it stands today, run through the last {risk.sessions} sessions of closes to {fmtDate(risk.asOf)}. Value at risk is historical: the loss a day or a month like the worst 5% of the past year would bring.</div>
      </div>

      <StatRow>
        <Stat label="Value at risk, 1 day (95%)" value={fmtRs(p.var95Rs)} size="lg" tone="negative" hint={`99%: ${fmtRs(p.var99Rs)} · expected shortfall beyond 95%: ${fmtRs(p.es95Rs)}`} />
        <Stat label="Value at risk, 20 sessions (95%)" value={fmtRs(p.var95_20dRs)} size="lg" tone="negative" hint={`${((p.var95_20dRs / risk.value) * 100).toFixed(1)}% of ${fmtRs(risk.value)}`} />
        <Stat label="Volatility, annualised" value={`${p.vol1yPct.toFixed(1)}%`} size="lg" hint={p.diversificationRatio != null ? `Names average ${(p.vol1yPct * p.diversificationRatio).toFixed(1)}%; diversification ratio ${p.diversificationRatio.toFixed(2)}` : undefined} />
        <Stat label="Beta to KSE-100" value={p.beta != null ? p.beta.toFixed(2) : "–"} size="lg" hint={`Worst session ${p.worstDay.pct.toFixed(1)}% (${fmtDate(p.worstDay.date)}) · best ${pct(p.bestDay.pct)}`} />
        <Stat label="Concentration" value={`${p.effectiveNames.toFixed(1)} names`} size="lg" hint={`Effective count from weights; top three ${p.top3WeightPct.toFixed(0)}% · max drawdown at today's weights ${p.maxDrawdown1yPct.toFixed(1)}%`} />
      </StatRow>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          <Card title="Where the risk sits" eyebrow="Each name's share of the book's variance against its share of its value">
            <div className="overflow-x-auto">
              <table className="table-zar">
                <thead>
                  <tr><th>Name</th><th className="text-right">Weight</th><th className="text-right">Risk share</th><th></th><th className="text-right">Vol 1y</th><th className="text-right">Vol 60d</th><th className="text-right">Beta</th><th className="text-right">Corr</th><th className="text-right">Max DD 1y</th><th className="text-right">60d vs index</th><th className="text-right">Days to exit</th></tr>
                </thead>
                <tbody>
                  {risk.names.map((n) => (
                    <tr key={n.symbol}>
                      <td><Link href={`/holdings/${n.symbol}`} className="font-medium hover:text-[var(--accent-deep)]">{n.symbol}</Link><div className="text-[11px] text-muted">{n.sector}</div></td>
                      <td className="text-right font-mono mono-num">{n.weightPct.toFixed(1)}%</td>
                      <td className="text-right font-mono mono-num" style={{ color: n.riskContributionPct > n.weightPct + 3 ? "var(--negative)" : undefined }}>{n.riskContributionPct.toFixed(1)}%</td>
                      <td style={{ minWidth: 90 }}><div className="h-1.5 rounded-full bg-[var(--surface-2)]"><div className="h-full rounded-full" style={{ width: `${(Math.abs(n.riskContributionPct) / maxContribution) * 100}%`, background: "var(--amber)" }} /></div></td>
                      <td className="text-right font-mono mono-num">{n.vol1yPct.toFixed(0)}%</td>
                      <td className="text-right font-mono mono-num">{n.vol60Pct.toFixed(0)}%</td>
                      <td className="text-right font-mono mono-num">{n.beta != null ? n.beta.toFixed(2) : "–"}</td>
                      <td className="text-right font-mono mono-num">{n.corrToIndex != null ? n.corrToIndex.toFixed(2) : "–"}</td>
                      <td className="text-right font-mono mono-num" style={{ color: "var(--negative)" }}>{n.maxDrawdown1yPct.toFixed(0)}%</td>
                      <td className="text-right font-mono mono-num" style={{ color: n.ret60Pct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(n.ret60Pct, 1)}</td>
                      <td className="text-right font-mono mono-num">{n.daysToExit != null ? (n.daysToExit < 1 ? "<1" : n.daysToExit.toFixed(1)) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-muted mt-2">Days to exit assumes selling a fifth of the name's average daily volume. A risk share well above the weight means the name moves more than its size, or with everything else.</div>
          </Card>
        </div>
        <Card title="By sector" eyebrow="Weight of the book">
          <div className="space-y-2">
            {p.sectors.map((s) => (
              <div key={s.sector} className="grid grid-cols-[1fr_auto] gap-3 items-center text-[12.5px]">
                <div>
                  <div className="flex justify-between"><span>{s.sector}</span><span className="font-mono mono-num">{s.weightPct.toFixed(1)}%</span></div>
                  <div className="h-1.5 rounded-full bg-[var(--surface-2)] mt-1"><div className="h-full rounded-full" style={{ width: `${s.weightPct}%`, background: "var(--series-2)" }} /></div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-muted mt-3">Herfindahl {p.hhi.toFixed(3)}: the book behaves like {p.effectiveNames.toFixed(1)} equal positions.</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <Card title="Stress tests" eyebrow="What the book loses when the index is shocked, and on the index's own worst windows">
          <table className="table-zar">
            <thead><tr><th>Scenario</th><th className="text-right">Index</th><th className="text-right">Book</th><th className="text-right">Rupees</th></tr></thead>
            <tbody>
              {risk.scenarios.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}<div className="text-[11px] text-muted">{s.note}</div></td>
                  <td className="text-right font-mono mono-num">{s.indexPct ? pct(s.indexPct) : "–"}</td>
                  <td className="text-right font-mono mono-num" style={{ color: s.portfolioPct >= 0 ? "var(--positive)" : "var(--negative)" }}>{pct(s.portfolioPct)}</td>
                  <td className="text-right font-mono mono-num" style={{ color: s.portfolioRs >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(s.portfolioRs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
                      <td key={j} className="font-mono mono-num text-center rounded" style={{ background: i === j ? "var(--surface-2)" : corrShade(c), width: 34, height: 26 }} title={`${s} × ${risk.correlations.symbols[j]}: ${c.toFixed(2)}`}>
                        {i === j ? "" : c.toFixed(2).replace("0.", ".")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
