import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Table, type Column } from "@/components/ui/Table";
import { Card } from "@/components/ui/Card";
import {
  getNetWorth,
  getPortfolioSummary,
  getMutualFundsValued,
  getSavingsValued,
  getCashSummary,
  checkDataAvailability,
} from "@/lib/data";
import { currentTaxYear } from "@/lib/dates";
import { fmtRs, fmtUsd, fmtSignedRs, fmtPct } from "@/lib/format";
import { getUsdPkr } from "@/lib/fx";
import type { PositionRow } from "@/lib/calculations";
import { computeBenchmark } from "@/lib/feeds/benchmark";

export const dynamic = "force-dynamic";

type MonthlyRel = { month: string; you: number | null; kse: number | null; rel: number | null; youTR: number | null };

// Month-end relative performance + drawdown, derived from the same daily
// benchmark series the overview chart draws. Price-only vs KSE-100 is the
// like-for-like column (the index as quoted excludes dividends); the TR column
// is your true return with dividends reinvested.
function monthlyRelative(points: Array<{ date: string; portfolio: number | null; portfolioTR: number | null; kse100: number | null }>) {
  const byMonth = new Map<string, { portfolio: number | null; portfolioTR: number | null; kse100: number | null }>();
  for (const p of points) byMonth.set(p.date.slice(0, 7), p); // last point of each month wins
  const months = [...byMonth.keys()].sort();
  const rows: MonthlyRel[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth.get(months[i - 1])!;
    const cur = byMonth.get(months[i])!;
    const ret = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? (a / b - 1) * 100 : null);
    const you = ret(cur.portfolio, prev.portfolio);
    const kse = ret(cur.kse100, prev.kse100);
    rows.push({ month: months[i], you, kse, rel: you != null && kse != null ? you - kse : null, youTR: ret(cur.portfolioTR, prev.portfolioTR) });
  }
  return rows.reverse(); // newest first
}

function maxDrawdownPct(points: Array<{ portfolioTR: number | null }>): number | null {
  let peak = -Infinity;
  let worst = 0;
  let seen = false;
  for (const p of points) {
    if (p.portfolioTR == null) continue;
    seen = true;
    peak = Math.max(peak, p.portfolioTR);
    if (peak > 0) worst = Math.min(worst, (p.portfolioTR / peak - 1) * 100);
  }
  return seen ? worst : null;
}

export default async function WealthPage() {
  const avail = await checkDataAvailability();
  const [netWorth, summary, funds, savings, cash, usdPkr, bench] = await Promise.all([
    getNetWorth(),
    getPortfolioSummary(),
    getMutualFundsValued(),
    getSavingsValued(),
    getCashSummary(),
    getUsdPkr(),
    computeBenchmark("ALL").catch(() => null),
  ]);
  const monthly = bench ? monthlyRelative(bench.points).slice(0, 12) : [];
  const drawdown = bench ? maxDrawdownPct(bench.points) : null;
  const cumYou = bench?.returns?.portfolio ?? null;
  const cumTR = bench?.returns?.portfolioTR ?? null;
  const cumKse = bench?.returns?.kse100 ?? null;

  const ty = currentTaxYear();
  const equityRows = summary.positions.filter((p) => p.shares > 0);
  const totalCost = equityRows.reduce((s, p) => s + p.totalCost, 0);
  const totalGain = netWorth.equity - totalCost;
  const usd = (rs: number) => (usdPkr ? `≈ ${fmtUsd(rs, usdPkr, false)}` : undefined);

  const cols: Column<PositionRow>[] = [
    { key: "sym", header: "Symbol", render: (p) => <span className="font-mono font-medium">{p.symbol}</span> },
    { key: "sector", header: "Sector", render: (p) => <span className="text-[12px] text-muted">{p.sector}</span> },
    { key: "cost", header: "Cost", align: "right", mono: true, render: (p) => fmtRs(p.totalCost) },
    { key: "value", header: "Market value", align: "right", mono: true, render: (p) => fmtRs(p.marketValue) },
    { key: "gain", header: "Unrealised", align: "right", mono: true, render: (p) => <span style={{ color: p.unrealizedPL >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(p.unrealizedPL)}</span> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={`Wealth · ${ty.fbrName}`}
        title="Your statement of assets."
        subtitle={`A snapshot for the FBR wealth statement — all assets at current value, with cost basis. The tax year ends 30 June ${ty.endYear}. Print this page for your records.`}
      />
      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Net worth" value={fmtRs(netWorth.total)} size="lg" hint={usd(netWorth.total)} />
        <Stat label="Equity cost" value={fmtRs(totalCost)} hint={usd(totalCost)} />
        <Stat label="Equity value" value={fmtRs(netWorth.equity)} hint={usd(netWorth.equity)} />
        <Stat label="Unrealised gain" value={fmtSignedRs(totalGain)} tone={totalGain >= 0 ? "positive" : "negative"} />
        <Stat label="Funds" value={fmtRs(netWorth.funds)} />
        <Stat label="Cash + savings" value={fmtRs(netWorth.savings + netWorth.cash)} />
      </StatRow>

      <Section number="01" title="Assets at a glance" display="Where it all sits.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {netWorth.breakdown.map((b) => (
            <Card key={b.label}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="label-cap">{b.label}</div>
                  <div className="text-[11px] text-muted font-mono mt-1">
                    {netWorth.total > 0 ? fmtPct(b.value / netWorth.total, 1) : "—"} of net worth
                  </div>
                </div>
                <div className="font-display mono-num text-[22px]" style={{ fontVariationSettings: "'opsz' 144" }}>
                  {fmtRs(b.value)}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section number="02" title="Listed equities" display="Holding by holding.">
        <Table columns={cols} rows={equityRows} rowKey={(p) => p.symbol} empty="No equities." />
      </Section>

      {funds.length > 0 && (
        <Section number="03" title="Mutual funds" display="At today's NAV.">
          <Table
            columns={[
              { key: "name", header: "Fund", render: (f: any) => <span className="text-[13px]">{f.name}</span> },
              { key: "units", header: "Units", align: "right", mono: true, render: (f: any) => f.units.toLocaleString() },
              { key: "nav", header: "NAV", align: "right", mono: true, render: (f: any) => fmtRs(f.nav, true) },
              { key: "value", header: "Value", align: "right", mono: true, render: (f: any) => fmtRs(f.value) },
            ]}
            rows={funds}
            rowKey={(f: any) => f._id}
            empty=""
          />
        </Section>
      )}

      {savings.length > 0 && (
        <Section number="04" title="Savings" display="Accrued balances.">
          <Table
            columns={[
              { key: "name", header: "Account", render: (a: any) => <span className="text-[13px]">{a.name}</span> },
              { key: "rate", header: "Rate", align: "right", mono: true, render: (a: any) => `${a.ratePercent}%` },
              { key: "bal", header: "Balance", align: "right", mono: true, render: (a: any) => fmtRs(a.balance) },
            ]}
            rows={savings}
            rowKey={(a: any) => a._id}
            empty=""
          />
        </Section>
      )}

      {monthly.length > 0 && (
        <Section
          number="05"
          title="You vs KSE-100"
          display="Did the stock-picking earn its keep?"
          description="Month by month against the index. The like-for-like column is price-only (KSE-100 as quoted excludes dividends); 'with divs' is your true total return. A long streak of red relatives is the argument for an index-like core."
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat label="You (price, window)" value={cumYou != null ? `${cumYou >= 0 ? "+" : ""}${cumYou.toFixed(1)}%` : "—"} tone={cumYou != null && cumYou >= 0 ? "positive" : "negative"} />
            <Stat label="KSE-100 (window)" value={cumKse != null ? `${cumKse >= 0 ? "+" : ""}${cumKse.toFixed(1)}%` : "—"} tone="muted" />
            <Stat
              label="Relative"
              value={cumYou != null && cumKse != null ? `${cumYou - cumKse >= 0 ? "+" : ""}${(cumYou - cumKse).toFixed(1)} pp` : "—"}
              tone={cumYou != null && cumKse != null && cumYou >= cumKse ? "positive" : "negative"}
            />
            <Stat label="Max drawdown (with divs)" value={drawdown != null ? `${drawdown.toFixed(1)}%` : "—"} tone="muted" hint={cumTR != null ? `total return ${cumTR >= 0 ? "+" : ""}${cumTR.toFixed(1)}%` : undefined} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Month</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">You (price)</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">KSE-100</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">Relative</th>
                  <th className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium text-right">You (with divs)</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => {
                  const cell = (v: number | null, signed = true) =>
                    v == null ? <span className="text-muted">—</span> : <span style={signed ? { color: v >= 0 ? "var(--positive)" : "var(--negative)" } : undefined}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
                  return (
                    <tr key={m.month} className="border-b border-rule">
                      <td className="px-2 py-1.5 font-mono">{m.month}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.you)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.kse)}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{m.rel == null ? <span className="text-muted">—</span> : <span style={{ color: m.rel >= 0 ? "var(--positive)" : "var(--negative)" }}>{m.rel >= 0 ? "+" : ""}{m.rel.toFixed(1)} pp</span>}</td>
                      <td className="px-2 py-1.5 text-right font-mono mono-num">{cell(m.youTR)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-2">Partial first and current months are shown as-is. Last 12 month-ends from the daily series.</p>
        </Section>
      )}

      <p className="text-[11px] text-muted font-mono mt-8">
        Values are current (not as-of 30 June). For a precise year-end statement, snapshot this page on 30 June.
        Cash balance: {fmtRs(cash.balance)}.
      </p>
    </div>
  );
}
