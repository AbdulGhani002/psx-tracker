import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { StressTester } from "./StressTester";
import { getRiskAnalysis, checkDataAvailability } from "@/lib/data";
import { fmtRs, fmtCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

type PosRow = { symbol: string; sector: string; value: number; pct: number; overCap: boolean };
type SectorRow = { sector: string; value: number; pct: number };

export default async function RiskPage() {
  const avail = await checkDataAvailability();
  const { concentration: c, correlation: corr, stressBase, safeRatePct, concentrationCap } = await getRiskAnalysis();

  const concVerdictTone = c.verdict === "well diversified" ? "positive" : c.verdict === "moderately concentrated" ? "amber" : "negative";

  const posCols: Column<PosRow>[] = [
    {
      key: "symbol",
      header: "Holding",
      render: (p) => (
        <Link href={`/holdings/${p.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
          {p.symbol}
        </Link>
      ),
    },
    { key: "sector", header: "Sector", render: (p) => <span className="text-[12px] text-muted">{p.sector}</span> },
    { key: "value", header: "Value", align: "right", mono: true, render: (p) => fmtCompact(p.value) },
    {
      key: "pct",
      header: "% of equity",
      align: "right",
      mono: true,
      render: (p) => <span style={{ color: p.overCap ? "var(--negative)" : undefined }}>{p.pct.toFixed(1)}%{p.overCap ? " ⚠" : ""}</span>,
    },
  ];

  const overCap = c.positions.filter((p) => p.overCap);

  return (
    <div>
      <PageHeader
        eyebrow="Analysis"
        title="How risky is the mix?"
        subtitle="Concentration (how much rides on one name or sector), correlation (whether your holdings move together), and a stress test (what a market drop does to your net worth and income)."
      >
        <Link href="/settings" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
          Concentration cap: {concentrationCap}%
        </Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Diversification" value={c.verdict.split(" ")[0]} tone={concVerdictTone as any} size="lg" hint={c.verdict} />
        <Stat label="Top holding" value={`${c.top1Pct.toFixed(0)}%`} tone={c.top1Pct > concentrationCap ? "negative" : "default"} />
        <Stat label="Top 3" value={`${c.top3Pct.toFixed(0)}%`} tone="muted" />
        <Stat label="Effective holdings" value={c.effectiveHoldings.toFixed(1)} tone="muted" hint={`HHI ${c.hhi.toFixed(2)}`} />
        <Stat label="Avg correlation" value={corr.avgPairwise == null ? "—" : corr.avgPairwise.toFixed(2)} tone={corr.avgPairwise != null && corr.avgPairwise > 0.6 ? "negative" : "muted"} hint="daily returns" />
      </StatRow>

      <Section number="01" title="Stress test" display="What a drawdown costs you." description="Drag the market drop. It hits equities and funds; savings and cash hold.">
        <StressTester base={stressBase} safeRatePct={safeRatePct} />
      </Section>

      <Section number="02" title="Concentration" display="Where the money sits." description={`Anything over your ${concentrationCap}% single-name cap is flagged. "Effective holdings" is how many equal-weight positions your mix behaves like — higher is more diversified.`}>
        {overCap.length > 0 && (
          <p className="text-[12px] mb-3" style={{ color: "var(--negative)" }}>
            Over the {concentrationCap}% cap: {overCap.map((p) => `${p.symbol} (${p.pct.toFixed(0)}%)`).join(", ")}.
          </p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Table columns={posCols} rows={c.positions} rowKey={(p) => p.symbol} empty="No holdings." />
          <Card>
            <div className="label-cap mb-3">By sector</div>
            <div className="space-y-2">
              {c.sectors.map((s: SectorRow) => (
                <div key={s.sector}>
                  <div className="flex justify-between text-[12px] mb-0.5">
                    <span>{s.sector}</span>
                    <span className="font-mono mono-num">{s.pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-[5px]" style={{ background: "var(--rule)" }}>
                    <div className="h-full" style={{ width: `${Math.min(100, s.pct)}%`, background: "var(--accent)" }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      <Section number="03" title="Correlation" display="Do they move together?" description="Pearson correlation of daily returns over the available price history. Two names near +1 give little diversification; lower or negative is better.">
        {corr.symbols.length < 2 ? (
          <Card><p className="text-[13px] text-muted">Need at least two holdings with price history to correlate.</p></Card>
        ) : (
          <Card>
            {corr.mostCorrelated && (
              <p className="text-[13px] mb-3">
                Most correlated: <span className="font-mono">{corr.mostCorrelated.a}</span> &amp; <span className="font-mono">{corr.mostCorrelated.b}</span> at{" "}
                <span className="font-mono mono-num" style={{ color: corr.mostCorrelated.r > 0.6 ? "var(--negative)" : "var(--ink)" }}>{corr.mostCorrelated.r.toFixed(2)}</span>.
                Average pairwise {corr.avgPairwise?.toFixed(2)}.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="text-[12px] mono-num">
                <thead>
                  <tr>
                    <th />
                    {corr.symbols.map((s) => <th key={s} className="px-2 py-1 font-mono text-muted">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {corr.symbols.map((row, i) => (
                    <tr key={row}>
                      <td className="px-2 py-1 font-mono text-muted">{row}</td>
                      {corr.symbols.map((_, j) => {
                        const v = corr.matrix[i][j];
                        const bg = v == null ? "transparent" : v >= 0 ? `rgba(168,90,74,${Math.min(0.5, Math.abs(v) * 0.5)})` : `rgba(107,125,94,${Math.min(0.5, Math.abs(v) * 0.5)})`;
                        return <td key={j} className="px-2 py-1 text-center" style={{ background: bg }}>{v == null ? "—" : v.toFixed(2)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
}
