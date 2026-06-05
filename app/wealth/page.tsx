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
import { fmtRs, fmtSignedRs, fmtPct } from "@/lib/format";
import type { PositionRow } from "@/lib/calculations";

export const dynamic = "force-dynamic";

export default async function WealthPage() {
  const avail = await checkDataAvailability();
  const [netWorth, summary, funds, savings, cash] = await Promise.all([
    getNetWorth(),
    getPortfolioSummary(),
    getMutualFundsValued(),
    getSavingsValued(),
    getCashSummary(),
  ]);

  const ty = currentTaxYear();
  const equityRows = summary.positions.filter((p) => p.shares > 0);
  const totalCost = equityRows.reduce((s, p) => s + p.totalCost, 0);
  const totalGain = netWorth.equity - totalCost;

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
        <Stat label="Net worth" value={fmtRs(netWorth.total)} size="lg" />
        <Stat label="Equity cost" value={fmtRs(totalCost)} />
        <Stat label="Equity value" value={fmtRs(netWorth.equity)} />
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

      <p className="text-[11px] text-muted font-mono mt-8">
        Values are current (not as-of 30 June). For a precise year-end statement, snapshot this page on 30 June.
        Cash balance: {fmtRs(cash.balance)}.
      </p>
    </div>
  );
}
