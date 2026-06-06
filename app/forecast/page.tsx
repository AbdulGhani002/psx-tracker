import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, type Column } from "@/components/ui/Table";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { getDividendForecast, checkDataAvailability } from "@/lib/data";
import { fmtRs, fmtNum, fmtDate } from "@/lib/format";
import type { ForecastEvent, SymbolDividendProfile } from "@/lib/calculations";

export const dynamic = "force-dynamic";

function confTone(c: "high" | "medium" | "low"): "positive" | "amber" | "default" {
  return c === "high" ? "positive" : c === "medium" ? "amber" : "default";
}

export default async function ForecastPage() {
  const avail = await checkDataAvailability();
  const f = await getDividendForecast();

  const haveData = f.profiles.length > 0;
  const change = f.paidLast12m > 0 ? (f.total12m - f.paidLast12m) / f.paidLast12m : null;

  const profileCols: Column<SymbolDividendProfile>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (p) => (
        <Link href={`/holdings/${p.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
          {p.symbol}
        </Link>
      ),
    },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (p) => fmtNum(p.shares) },
    { key: "rate", header: "Annual rate/share", align: "right", mono: true, render: (p) => fmtRs(p.inferredAnnualRatePerShare, true) },
    { key: "freq", header: "Payouts/yr", align: "right", mono: true, render: (p) => String(p.paymentsPerYear) },
    {
      key: "income",
      header: "Est. annual income",
      align: "right",
      mono: true,
      render: (p) => (
        <span style={{ color: "var(--positive)" }}>{fmtRs(p.inferredAnnualRatePerShare * p.shares)}</span>
      ),
    },
    { key: "last", header: "Last paid", render: (p) => <span className="font-mono text-[12px]">{fmtDate(p.lastPaymentDate)}</span> },
    { key: "conf", header: "Confidence", render: (p) => <Badge tone={confTone(p.confidence)}>{p.confidence}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Dividends / Forecast"
        title="The cash coming your way."
        subtitle="A 12-month projection built from each holding's own payout history. We repeat last year's dividends forward at the same per-share rate, scaled by the shares you hold today. It is an estimate, not a promise — companies change or skip payouts."
      >
        <Link href="/dividends" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
          Recorded dividends
        </Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Forecast next 12m" value={fmtRs(f.total12m)} tone="positive" size="lg" />
        <Stat label="Paid last 12m" value={fmtRs(f.paidLast12m)} tone="muted" />
        <Stat
          label="Change"
          value={change == null ? "—" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}%`}
          tone={change != null && change >= 0 ? "positive" : "default"}
        />
        <Stat label="Income holdings" value={String(f.profiles.length)} tone="muted" />
        <Stat label="Forecast events" value={String(f.events.length)} tone="muted" />
      </StatRow>

      {!haveData && (
        <div className="mt-8">
          <Card>
            <p className="text-[14px] text-muted">
              No dividend history to forecast from yet. Once you record dividends (upload CDC warrant PDFs on
              the <Link href="/dividends" className="underline">Dividends</Link> page), this calendar fills in automatically.
            </p>
          </Card>
        </div>
      )}

      {haveData && (
        <>
          <Section number="01" title="Forward 12 months" display="Month by month." description="Each month shows the dividends expected from your current holdings. Months with nothing expected are left blank.">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {f.months.map((m) => (
                <Card key={`${m.year}-${m.month}`}>
                  <div className="flex items-baseline justify-between mb-2">
                    <div className="section-eyebrow">{m.label}</div>
                    <div className="font-display mono-num text-[18px]" style={{ color: m.total > 0 ? "var(--positive)" : "var(--muted)" }}>
                      {m.total > 0 ? fmtRs(m.total) : "—"}
                    </div>
                  </div>
                  {m.events.length === 0 ? (
                    <div className="text-[12px] text-muted">No dividends expected.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {m.events.map((e: ForecastEvent, i: number) => (
                        <div key={`${e.symbol}-${i}`} className="flex items-center justify-between text-[12px]">
                          <span className="font-mono">{e.symbol}</span>
                          <span className="font-mono mono-num text-muted">
                            {fmtRs(e.expectedRatePerShare, true)}/sh
                          </span>
                          <span className="font-mono mono-num">{fmtRs(e.expectedGross)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </Section>

          <Section number="02" title="By holding" display="Who pays what." description="Inferred annual rate per share and estimated yearly income for each dividend payer you hold. Confidence reflects how much payout history we have.">
            <Table
              columns={profileCols}
              rows={f.profiles}
              rowKey={(p) => p.symbol}
              empty="No income holdings."
            />
          </Section>
        </>
      )}
    </div>
  );
}
