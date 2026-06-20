import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import Link from "next/link";
import { getTaxReport, getCgtReport, getHarvestReport, getSellTodayCgt, getAllTransactions, getAppSettings, checkDataAvailability } from "@/lib/data";
import { dividendWhtFlags } from "@/lib/calculations/tax";
import { fmtRs, fmtPct, fmtDate, fmtSignedRs, fmtNum } from "@/lib/format";
import type { DividendTaxRow } from "@/lib/calculations";
import type { Disposal } from "@/lib/calculations/lots";

export const dynamic = "force-dynamic";

export default async function TaxPage() {
  const avail = await checkDataAvailability();
  const [report, cgt, harvest, sellToday, txs, settings] = await Promise.all([
    getTaxReport(),
    getCgtReport(),
    getHarvestReport(),
    getSellTodayCgt(),
    getAllTransactions(),
    getAppSettings(),
  ]);
  const flags = dividendWhtFlags(txs, settings.dividendWhtFiler);
  const isFiler = settings.filerStatus === "filer";

  const disposalCols: Column<Disposal>[] = [
    { key: "sold", header: "Sold", render: (d) => <span className="font-mono text-[12px]">{fmtDate(d.soldDate)}</span> },
    { key: "sym", header: "Symbol", render: (d) => <span className="font-mono font-medium">{d.symbol}</span> },
    { key: "sh", header: "Shares", align: "right", mono: true, render: (d) => fmtNum(d.shares) },
    { key: "acq", header: "Acquired", render: (d) => <span className="font-mono text-[12px] text-muted">{fmtDate(d.acquired)}</span> },
    { key: "hold", header: "Held", align: "right", mono: true, render: (d) => <span>{fmtNum(d.holdingDays)}d{d.longTerm ? " " : ""}{d.longTerm && <Badge tone="default">LT</Badge>}</span> },
    { key: "cost", header: "Cost", align: "right", mono: true, render: (d) => fmtRs(d.cost) },
    { key: "proceeds", header: "Proceeds", align: "right", mono: true, render: (d) => fmtRs(d.proceeds) },
    { key: "gain", header: "Gain", align: "right", mono: true, render: (d) => <span style={{ color: d.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(d.gain)}</span> },
  ];

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

      <Section
        number="02"
        title="Capital gains (FIFO lots)"
        display="Exact gains, lot by lot."
        description="Each sell matched against your oldest buy lots (FIFO), with the real holding period and per-disposal gain — not an average-cost estimate. CGT applies the rate from Settings; losses offset gains within a tax year."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="Net realised gain" value={fmtSignedRs(cgt.summary.netGain)} tone={cgt.summary.netGain >= 0 ? "positive" : "negative"} />
          <Stat label="Long-term gain" value={fmtSignedRs(cgt.summary.longTermGain)} tone="muted" hint="held > 365d" />
          <Stat label="Short-term gain" value={fmtSignedRs(cgt.summary.shortTermGain)} tone="muted" />
          <Stat label={`CGT @ ${cgt.rate}%`} value={fmtRs(cgt.summary.cgt)} tone="accent" />
        </div>
        {cgt.summary.byYear.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3">
            {cgt.summary.byYear.map((y) => (
              <div key={y.taxYear} className="border border-rule px-3 py-2">
                <div className="label-cap">{y.label}</div>
                <div className="font-mono mono-num text-[13px]">
                  net {fmtSignedRs(y.netGain)} · CGT {fmtRs(y.cgt)}
                </div>
              </div>
            ))}
          </div>
        )}
        <Table columns={disposalCols} rows={cgt.recentDisposals} rowKey={(d) => `${d.symbol}-${d.soldDate}-${d.acquired}-${d.shares}`} empty="No sells yet — CGT appears when you realise a gain." />
      </Section>

      <Section
        number="03"
        title="If you sold today"
        display="Your CGT bill, right now."
        description={`Per open position: the share-weighted holding period and the CGT you'd owe on the gain at your ${sellToday.rate}% rate. Long-term shares (held over a year) are flagged.`}
      >
        {harvest.offsetPotential > 0 && (
          <div className="mb-4 p-3 border-l-[4px]" style={{ borderColor: "var(--accent)", background: "var(--paper-2)" }}>
            <span className="font-mono text-[13px]">
              ⏰ <strong>{sellToday.daysToYearEnd} days</strong> left in this tax year (closes {fmtDate(sellToday.yearEnd)}). You have{" "}
              <span style={{ color: "var(--negative)" }}>{fmtRs(Math.abs(harvest.totalHarvestableLoss))}</span> of harvestable losses — selling
              them before 30 June would offset gains and cut about{" "}
              <span style={{ color: "var(--positive)" }}>{fmtRs(harvest.cgtSaved)}</span> off your CGT.
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="Unrealised gain (open)" value={fmtSignedRs(sellToday.totalGain)} tone={sellToday.totalGain >= 0 ? "positive" : "negative"} />
          <Stat label={`CGT if sold today @ ${sellToday.rate}%`} value={fmtRs(sellToday.totalCgt)} tone="accent" />
          <Stat label="Tax-year ends" value={fmtDate(sellToday.yearEnd)} tone="muted" hint={`${sellToday.daysToYearEnd} days left`} />
          <Stat label="Net after CGT" value={fmtRs(sellToday.totalGain - sellToday.totalCgt)} tone="muted" />
        </div>
        <Table
          columns={[
            { key: "sym", header: "Symbol", render: (r: any) => <span className="font-mono font-medium">{r.symbol}</span> },
            { key: "held", header: "Held (avg)", align: "right", mono: true, render: (r: any) => <span>{fmtNum(Math.round(r.weightedDays))}d {r.longTermShares > 0 && <Badge tone="default">LT</Badge>}</span> },
            { key: "val", header: "Value", align: "right", mono: true, render: (r: any) => fmtRs(r.marketValue) },
            { key: "gain", header: "Unrealised", align: "right", mono: true, render: (r: any) => <span style={{ color: r.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(r.gain)}</span> },
            { key: "cgt", header: "CGT if sold", align: "right", mono: true, render: (r: any) => (r.gain > 0 ? fmtRs(r.cgtIfSold) : "—") },
          ]}
          rows={sellToday.rows}
          rowKey={(r: any) => r.symbol}
          empty="No open positions."
        />
      </Section>

      <Section
        number="04"
        title="Tax-loss harvesting"
        display="Losses you could bank to cut CGT."
        description="Open positions trading below cost. Selling them realises a loss that offsets your realised gains this tax year, lowering CGT. (You can re-buy later — Pakistan has no wash-sale rule, but mind your thesis.)"
      >
        {harvest.candidates.length === 0 ? (
          <Card><p className="text-sm text-muted">No positions are currently at an unrealised loss.</p></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Stat label="Harvestable loss" value={fmtRs(Math.abs(harvest.totalHarvestableLoss))} tone="negative" />
              <Stat label="Realised gain (this yr)" value={fmtRs(Math.max(0, harvest.realizedGainThisYear))} tone="positive" />
              <Stat label="Offsettable" value={fmtRs(harvest.offsetPotential)} tone="accent" />
              <Stat label="CGT you'd save" value={fmtRs(harvest.cgtSaved)} tone="positive" />
            </div>
            <Table
              columns={[
                { key: "sym", header: "Symbol", render: (c: any) => <span className="font-mono font-medium">{c.symbol}</span> },
                { key: "sh", header: "Shares", align: "right", mono: true, render: (c: any) => fmtNum(c.shares) },
                { key: "avg", header: "Avg cost", align: "right", mono: true, render: (c: any) => fmtRs(c.avgCost, true) },
                { key: "px", header: "Price", align: "right", mono: true, render: (c: any) => fmtRs(c.currentPrice, true) },
                { key: "loss", header: "Unrealised loss", align: "right", mono: true, render: (c: any) => <span style={{ color: "var(--negative)" }}>{fmtSignedRs(c.unrealizedLoss)}</span> },
              ]}
              rows={harvest.candidates}
              rowKey={(c: any) => c.symbol}
              empty=""
            />
          </>
        )}
      </Section>

      {flags.length > 0 && (
        <Section number="05" title="WHT band check" display="Rates that look off.">
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
