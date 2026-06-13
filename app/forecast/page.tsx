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

function healthTone(s: SymbolDividendProfile["sustainability"]): "positive" | "amber" | "negative" | "default" {
  if (s === "comfortable") return "positive";
  if (s === "stretched") return "amber";
  if (s === "at risk" || s === "above earnings") return "negative";
  return "default";
}

function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export default async function ForecastPage() {
  const avail = await checkDataAvailability();
  const f = await getDividendForecast();

  const haveData = f.profiles.length > 0;
  const withEps = f.profiles.filter((p) => p.latestEps != null).length;

  const profileCols: Column<SymbolDividendProfile>[] = [
    {
      key: "symbol",
      header: "Symbol",
      render: (p) => (
        <span className="flex items-center gap-1.5">
          <Link href={`/holdings/${p.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
            {p.symbol}
          </Link>
          {p.hasSplit && <span className="label-cap" title="Face value adjusted for a share split">split</span>}
        </span>
      ),
    },
    { key: "eps", header: "EPS", align: "right", mono: true, render: (p) => (p.latestEps == null ? "—" : fmtRs(p.latestEps, true)) },
    {
      key: "par",
      header: "Par",
      align: "right",
      mono: true,
      render: (p) => {
        const note =
          p.faceValueSource === "calibrated"
            ? "Calibrated from your recorded dividends"
            : p.faceValueSource === "split-adjusted"
            ? "Adjusted for a share split"
            : "Assumed (PSX standard Rs 10)";
        return (
          <span title={note} style={{ color: p.faceValueSource === "assumed" ? "var(--muted)" : "var(--ink)" }}>
            {fmtRs(p.faceValue, true)}
            {p.faceValueSource === "calibrated" && <span className="text-[9px]" style={{ color: "var(--positive)" }}> ✓</span>}
          </span>
        );
      },
    },
    {
      key: "payout",
      header: "Payout",
      align: "right",
      mono: true,
      render: (p) => pct(p.appliedPayoutRatioPct),
    },
    { key: "cadence", header: "Cadence", render: (p) => <span className="text-[12px] capitalize">{p.cadence}</span> },
    {
      key: "declared",
      header: "Declared / yr",
      align: "right",
      mono: true,
      render: (p) => (
        <span className="text-muted">
          {p.declaredAnnualDps > 0 ? `${fmtRs(p.declaredAnnualDps, true)} · ${pct((p.declaredAnnualDps / p.faceValue) * 100)}` : "—"}
        </span>
      ),
    },
    {
      key: "dps",
      header: "Fwd DPS / yr",
      align: "right",
      mono: true,
      render: (p) => (
        <span>
          {fmtRs(p.forwardDpsAnnual, true)}
          {p.aboveEarnings && <span className="text-[10px]" style={{ color: "var(--negative)" }}> capped</span>}
        </span>
      ),
    },
    { key: "yield", header: "Yield", align: "right", mono: true, render: (p) => pct(p.forwardYieldPct, 1) },
    {
      key: "cover",
      header: "Cover",
      align: "right",
      mono: true,
      render: (p) => (p.dividendCover == null ? "—" : `${p.dividendCover.toFixed(1)}×`),
    },
    {
      key: "income",
      header: "Est. income / yr",
      align: "right",
      mono: true,
      render: (p) => <span style={{ color: p.expectedAnnualIncome > 0 ? "var(--positive)" : "var(--muted)" }}>{fmtRs(p.expectedAnnualIncome)}</span>,
    },
    { key: "health", header: "Health", render: (p) => <Badge tone={healthTone(p.sustainability)}>{p.sustainability}</Badge> },
    { key: "conf", header: "Conf.", render: (p) => <Badge tone={confTone(p.confidence)}>{p.confidence}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Dividends / Forecast"
        title="What they can realistically pay."
        subtitle="Grounded in each company's earnings, not just past payouts. We read EPS from PSX, work out the historical payout ratio, and cap the forward dividend at what profits can sustain — a loss-making year forecasts nothing. Everything is shown in percentage terms so you can judge it yourself."
      >
        <Link href="/dividends" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">
          Recorded dividends
        </Link>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Forecast next 12m" value={fmtRs(f.total12m)} tone="positive" size="lg" />
        <Stat label="Paid last 12m" value={fmtRs(f.paidLast12m)} tone="muted" />
        <Stat label="Income holdings" value={String(f.profiles.length)} tone="muted" />
        <Stat label="With EPS data" value={`${withEps}/${f.profiles.length}`} tone="muted" />
        <Stat label="Forecast events" value={String(f.events.length)} tone="muted" />
      </StatRow>

      {!haveData && (
        <div className="mt-8">
          <Card>
            <p className="text-[14px] text-muted">
              No dividend history to forecast from yet. Once you record dividends (upload CDC warrant PDFs on
              the <Link href="/dividends" className="underline">Dividends</Link> page), this fills in automatically.
            </p>
          </Card>
        </div>
      )}

      {haveData && (
        <>
          <Section
            number="01"
            title="Upcoming dividends"
            display="What's coming, when."
            description="The next 12 months of expected dividend payments, soonest first, on the months each company has historically paid. Amounts are the earnings-capped estimate."
          >
            <Table
              columns={[
                { key: "date", header: "Expected", render: (e: ForecastEvent) => <span className="font-mono text-[12px]">{fmtDate(e.date)}</span> },
                {
                  key: "symbol",
                  header: "Symbol",
                  render: (e: ForecastEvent) => (
                    <Link href={`/holdings/${e.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                      {e.symbol}
                    </Link>
                  ),
                },
                { key: "rate", header: "Rs / share", align: "right", mono: true, render: (e: ForecastEvent) => fmtRs(e.expectedRatePerShare, true) },
                { key: "shares", header: "Shares", align: "right", mono: true, render: (e: ForecastEvent) => fmtNum(Math.round(e.shares)) },
                { key: "gross", header: "Expected", align: "right", mono: true, render: (e: ForecastEvent) => <span style={{ color: "var(--positive)" }}>{fmtRs(e.expectedGross)}</span> },
                { key: "conf", header: "Conf.", render: (e: ForecastEvent) => <Badge tone={confTone(e.confidence)}>{e.confidence}</Badge> },
              ]}
              rows={f.events}
              rowKey={(e) => `${e.symbol}-${e.year}-${e.month}`}
              empty="No dividends expected in the next 12 months."
            />
          </Section>

          <Section
            number="02"
            title="By holding — the analysis"
            display="Earnings first, then dividend."
            description="EPS and payout ratio drive the forward dividend. Cover is EPS ÷ DPS — above 2× is comfortable, below 1× means they'd pay more than they earn (at risk). Payout is the share of earnings we assume goes to dividends, capped at 100%."
          >
            <Table columns={profileCols} rows={f.profiles} rowKey={(p) => p.symbol} empty="No income holdings." />
            <p className="text-[11px] text-muted mt-3 max-w-[80ch]">
              EPS, profit, and growth are scraped from dps.psx.com.pk (standardized by Capital Stake) and cached weekly.
              Par (face) value is calibrated from your recorded dividends where possible (marked ✓), adjusted for any split,
              else assumed Rs 10. Where PSX has no EPS, the estimate falls back to your recorded payout history at lower confidence.
            </p>
          </Section>

          {f.bonusEvents.length > 0 && (
            <Section
              number="03"
              title="Bonus shares ahead"
              display="Free shares, not cash."
              description="Companies that issue bonus shares grow your holding. Projected from their recent bonus history; dividends after the bonus date are forecast on the larger share count."
            >
              <Table
                columns={[
                  { key: "symbol", header: "Symbol", render: (b: (typeof f.bonusEvents)[number]) => <span className="font-mono font-medium">{b.symbol}</span> },
                  { key: "when", header: "Expected", render: (b: (typeof f.bonusEvents)[number]) => <span className="font-mono text-[12px]">{fmtDate(b.date)}</span> },
                  { key: "pct", header: "Bonus", align: "right", mono: true, render: (b: (typeof f.bonusEvents)[number]) => pct(b.bonusPct) },
                  {
                    key: "shares",
                    header: "Shares added",
                    align: "right",
                    mono: true,
                    render: (b: (typeof f.bonusEvents)[number]) => <span style={{ color: "var(--positive)" }}>+{fmtNum(b.sharesAdded)}</span>,
                  },
                ]}
                rows={f.bonusEvents}
                rowKey={(b) => `${b.symbol}-${b.year}-${b.month}`}
                empty="No bonus issues expected."
              />
            </Section>
          )}

          <Section
            number={f.bonusEvents.length > 0 ? "04" : "03"}
            title="Forward 12 months"
            display="Month by month."
            description="The realistic annual dividend, spread across the months each company has historically paid. Blank months expect nothing."
          >
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
                          <span className="font-mono mono-num text-muted">{fmtRs(e.expectedRatePerShare, true)}/sh</span>
                          <span className="font-mono mono-num">{fmtRs(e.expectedGross)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
