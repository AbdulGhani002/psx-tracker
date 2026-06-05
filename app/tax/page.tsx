import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import Link from "next/link";
import { getTaxReport, getAllTransactions, getAppSettings, checkDataAvailability } from "@/lib/data";
import { dividendWhtFlags } from "@/lib/calculations/tax";
import { fmtRs, fmtPct, fmtDate } from "@/lib/format";
import type { DividendTaxRow } from "@/lib/calculations";

export const dynamic = "force-dynamic";

export default async function TaxPage() {
  const avail = await checkDataAvailability();
  const [report, txs, settings] = await Promise.all([
    getTaxReport(),
    getAllTransactions(),
    getAppSettings(),
  ]);
  const flags = dividendWhtFlags(txs, settings.dividendWhtFiler);
  const isFiler = settings.filerStatus === "filer";

  const columns: Column<DividendTaxRow>[] = [
    { key: "label", header: "Tax year", render: (r) => <span className="font-mono text-[12px]">{r.label}</span> },
    { key: "count", header: "Payouts", align: "right", mono: true, render: (r) => String(r.count) },
    { key: "gross", header: "Gross", align: "right", mono: true, render: (r) => fmtRs(r.gross) },
    { key: "tax", header: "WHT", align: "right", mono: true, render: (r) => fmtRs(r.taxWithheld) },
    { key: "zakat", header: "Zakat", align: "right", mono: true, render: (r) => fmtRs(r.zakat) },
    { key: "net", header: "Net", align: "right", mono: true, render: (r) => <span style={{ color: "var(--positive)" }}>{fmtRs(r.net)}</span> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Tax"
        title="What you owe, and what you've paid."
        subtitle="Dividend withholding by FBR tax year (Jul–Jun), realised capital gains, and the cost of your filer status. Rates come from Settings — verify against the current FBR schedule."
      >
        <div className="flex items-center gap-3">
          <Badge tone={isFiler ? "positive" : "negative"}>{isFiler ? "FILER" : "NON-FILER"}</Badge>
          <Link href="/settings" className="label-cap hover:text-[var(--accent-deep)]">Change in Settings →</Link>
        </div>
      </PageHeader>

      {!avail.available && <SetupBanner reason={avail.reason} />}

      <StatRow>
        <Stat label="Dividends (gross, all yrs)" value={fmtRs(report.totalGross)} />
        <Stat label="WHT withheld" value={fmtRs(report.totalWithheld)} tone="muted" />
        <Stat label="Zakat" value={fmtRs(report.totalZakat)} tone="muted" />
        <Stat label="Realised gains" value={fmtRs(report.realizedGains)} tone={report.realizedGains >= 0 ? "positive" : "negative"} />
        <Stat label="Est. CGT on gains" value={fmtRs(report.estCgt)} tone="muted" />
        <Stat label="Net dividends" value={fmtRs(report.totalNet)} tone="positive" />
      </StatRow>

      <Section
        number="01"
        title="Filer vs non-filer"
        display="The cost of staying on the list."
        description="The penalty a non-filer pays versus a filer, on this tax year's dividends and on your realised gains."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <div className="label-cap mb-3">Dividend WHT this year</div>
            <div className="grid grid-cols-2 gap-4 font-mono mono-num">
              <div>
                <div className="text-[10px] tracking-stat uppercase text-muted">As filer ({settings.dividendWhtFiler}%)</div>
                <div className="text-[20px]" style={{ color: "var(--positive)" }}>{fmtRs(report.wht.filer)}</div>
              </div>
              <div>
                <div className="text-[10px] tracking-stat uppercase text-muted">As non-filer ({settings.dividendWhtNonFiler}%)</div>
                <div className="text-[20px]" style={{ color: "var(--negative)" }}>{fmtRs(report.wht.nonFiler)}</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-rule text-[13px]">
              Filing saves you{" "}
              <span className="font-mono mono-num font-medium" style={{ color: "var(--accent-deep)" }}>
                {fmtRs(report.dividendPenaltyIfNonFiler)}
              </span>{" "}
              on dividends this tax year.
            </div>
          </Card>
          <Card>
            <div className="label-cap mb-3">CGT on realised gains</div>
            <div className="grid grid-cols-2 gap-4 font-mono mono-num">
              <div>
                <div className="text-[10px] tracking-stat uppercase text-muted">As filer ({settings.cgtRateFiler}%)</div>
                <div className="text-[20px]" style={{ color: "var(--positive)" }}>{fmtRs(report.cgt.filer)}</div>
              </div>
              <div>
                <div className="text-[10px] tracking-stat uppercase text-muted">As non-filer ({settings.cgtRateNonFiler}%)</div>
                <div className="text-[20px]" style={{ color: "var(--negative)" }}>{fmtRs(report.cgt.nonFiler)}</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-rule text-[12px] text-muted">
              On {fmtRs(Math.max(0, report.realizedGains))} of realised gains. Estimate only — actual CGT
              depends on holding period and acquisition date.
            </div>
          </Card>
        </div>
      </Section>

      <Section number="02" title="Dividends by tax year" display="Filing-ready totals.">
        <Table columns={columns} rows={report.byYear} rowKey={(r) => String(r.taxYear)} empty="No dividends recorded." />
      </Section>

      {flags.length > 0 && (
        <Section number="03" title="WHT band check" display="Rates that look off.">
          <Card>
            <ul className="space-y-1.5 text-[13px]">
              {flags.map((f, i) => (
                <li key={i}>
                  <span className="font-mono">{f.symbol}</span> · {fmtDate(f.date)} —{" "}
                  <span style={{ color: "var(--accent-deep)" }}>{fmtPct(f.effectiveRate / 100, 1)}</span> effective WHT
                  {" "}({f.note})
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
    </div>
  );
}
