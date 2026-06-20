import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { StressTester } from "./StressTester";
import { getRiskAnalysis, getSectorComparison, checkDataAvailability } from "@/lib/data";
import { fmtRs, fmtCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

type PosRow = { symbol: string; sector: string; value: number; pct: number; overCap: boolean };
type SectorRow = { sector: string; value: number; pct: number };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default async function RiskPage() {
  const avail = await checkDataAvailability();
  const [{ concentration: c, correlation: corr, stressBase, safeRatePct, concentrationCap }, sec] = await Promise.all([
    getRiskAnalysis(),
    getSectorComparison(),
  ]);

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

      <Section
        number="03"
        title="Sector tilt vs KSE-100"
        display="Where you lean against the market."
        description="Your sector mix next to the KSE-100's own market-cap weighting (built from PSX data in the background and stored, so this loads instantly). Positive tilt = over-weight that sector versus the index."
      >
        {sec.comparison.length === 0 ? (
          <Card>
            <p className="text-[13px] text-muted">
              {sec.status === "missing" || sec.status === "building"
                ? "The KSE-100 sector snapshot is being prepared by the scheduled job. It will appear here on the next refresh."
                : sec.status === "error"
                ? `Couldn't build the index snapshot last run (${sec.note || "unknown error"}). The last good data, if any, is shown when available.`
                : "Add some equity holdings to compare your sector mix to the index."}
            </p>
          </Card>
        ) : (
          <Card>
            <p className="text-[12px] text-muted mb-3">
              Index side: {sec.index} · {sec.membersPriced}/{sec.membersTotal} members priced · snapshot {ago(sec.updatedAt)}
              {sec.status === "error" ? " · last refresh failed, showing previous data" : ""}.
            </p>
            <div className="space-y-2.5">
              {sec.comparison.map((s) => {
                const over = s.diffPct >= 0;
                const tone = Math.abs(s.diffPct) < 2 ? "var(--muted)" : over ? "var(--negative)" : "var(--positive)";
                return (
                  <div key={s.sector}>
                    <div className="flex justify-between items-baseline text-[12px] mb-1">
                      <span className="truncate pr-2">{s.sector}</span>
                      <span className="font-mono mono-num shrink-0" style={{ color: tone }}>
                        {over ? "+" : ""}{s.diffPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* your weight */}
                      <div className="flex-1 h-[6px]" style={{ background: "var(--rule)" }}>
                        <div className="h-full" style={{ width: `${Math.min(100, s.yourPct)}%`, background: "var(--accent)" }} />
                      </div>
                      <span className="font-mono mono-num text-[11px] w-12 text-right text-muted">{s.yourPct.toFixed(1)}%</span>
                      {/* index weight */}
                      <div className="flex-1 h-[6px]" style={{ background: "var(--rule)" }}>
                        <div className="h-full" style={{ width: `${Math.min(100, s.indexPct)}%`, background: "var(--ink)", opacity: 0.45 }} />
                      </div>
                      <span className="font-mono mono-num text-[11px] w-12 text-right text-muted">{s.indexPct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-[6px]" style={{ background: "var(--accent)" }} /> You</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-[6px]" style={{ background: "var(--ink)", opacity: 0.45 }} /> KSE-100</span>
            </div>
          </Card>
        )}
      </Section>

      <Section number="04" title="Correlation" display="Do they move together?" description="Pearson correlation of daily returns over the available price history. Two names near +1 give little diversification; lower or negative is better.">
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
