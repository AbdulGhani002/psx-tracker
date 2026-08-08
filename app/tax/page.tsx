import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { Stat, StatRow } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import Link from "next/link";
import { getTaxReport, getCgtReport, getHarvestReport, getSellTodayCgt, getAllTransactions, getAppSettings, getSavingsValued, getFbrPack, checkDataAvailability } from "@/lib/data";
import { whtPct } from "@/lib/calculations/pk-tax";
import { currentTaxYear } from "@/lib/dates";
import { dividendWhtFlags } from "@/lib/calculations/tax";
import { fmtRs, fmtPct, fmtDate, fmtSignedRs, fmtNum } from "@/lib/format";
import type { DividendTaxRow } from "@/lib/calculations";
import type { Disposal } from "@/lib/calculations/lots";

export const dynamic = "force-dynamic";

export default async function TaxPage({ searchParams }: { searchParams: { fbr?: string } }) {
  const avail = await checkDataAvailability();
  const fbrYear = searchParams?.fbr ? Number(searchParams.fbr) : undefined;
  const [report, cgt, harvest, sellToday, txs, settings, savingsAccts, fbr] = await Promise.all([
    getTaxReport(),
    getCgtReport(),
    getHarvestReport(),
    getSellTodayCgt(),
    getAllTransactions(),
    getAppSettings(),
    getSavingsValued(),
    getFbrPack(Number.isFinite(fbrYear) ? fbrYear : undefined),
  ]);
  const flags = dividendWhtFlags(txs, settings.dividendWhtFiler);
  // Headline CGT must be THIS tax year's FIFO figure — the old stat used the
  // lifetime average-cost estimate, which both uses the wrong basis (FBR wants
  // FIFO) and piles every past year's gains into "owed now".
  const ty = currentTaxYear();
  const cgtThisYear = cgt.summary.byYear.find((y) => y.label === ty.label)?.cgt ?? 0;
  const podWht = whtPct("profit-on-debt", settings as any);
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
        <Stat label={`CGT ${ty.label} (FIFO)`} value={fmtRs(cgtThisYear)} tone="muted" hint="exact, current tax year only" />
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

      <Section
        number="05"
        title="Dividend WHT by tax year"
        display="What was withheld, year by year"
        description="From your recorded dividend warrants: gross, withholding and zakat deducted at source, and what reached you — bucketed into Pakistan's July-June tax years."
      >
        <Table columns={columns} rows={report.byYear} rowKey={(r) => r.label} empty="No dividends recorded yet." />
      </Section>

      <Section
        number="06"
        title="FBR filing pack"
        display={`Everything the return needs — ${fbr.year.fbrName}.`}
        description="One tax year, filing-ready: every dividend payer with gross, WHT and zakat deducted at source (Sec 150), and every FIFO disposal with its exact gain. Export it and fill the return from one sheet. Savings profit-on-debt is filed from the bank's own certificate — an estimate has no place next to exact figures."
        action={
          <a href={`/api/export?sheet=fbr&year=${fbr.year.endYear}`} className="label-cap hover:text-[var(--accent-deep)]">
            Export CSV →
          </a>
        }
      >
        <div className="flex flex-wrap gap-1.5 mb-4">
          {fbr.years.map((y) => (
            <Link key={y} href={`/tax?fbr=${y}`} className="label-cap border px-2 py-1 font-mono" style={{ borderColor: fbr.year.endYear === y ? "var(--ink)" : "var(--rule)" }}>
              TY{y}
            </Link>
          ))}
          {fbr.years.length === 0 && <span className="text-[13px] text-muted">No dividends or disposals recorded yet.</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <div className="label-cap mb-2">Dividends by payer — Sec 150 ({fbr.year.label})</div>
            <Table
              columns={[
                { key: "sym", header: "Symbol", render: (r: any) => <span className="font-mono font-medium">{r.symbol}</span> },
                { key: "c", header: "Payouts", align: "right", mono: true, render: (r: any) => String(r.count) },
                { key: "g", header: "Gross", align: "right", mono: true, render: (r: any) => fmtRs(r.gross) },
                { key: "w", header: "WHT", align: "right", mono: true, render: (r: any) => fmtRs(r.wht) },
                { key: "z", header: "Zakat", align: "right", mono: true, render: (r: any) => fmtRs(r.zakat) },
                { key: "n", header: "Net", align: "right", mono: true, render: (r: any) => fmtRs(r.net) },
              ]}
              rows={fbr.dividends}
              rowKey={(r: any) => r.symbol}
              empty="No dividends in this tax year."
            />
            {fbr.dividends.length > 0 && (
              <div className="mt-2 pt-2 border-t border-ink font-mono mono-num text-[12px] flex justify-between">
                <span className="uppercase tracking-stat text-[10px] text-muted">Total</span>
                <span>gross {fmtRs(fbr.divTotals.gross)} · WHT {fmtRs(fbr.divTotals.wht)} · zakat {fmtRs(fbr.divTotals.zakat)} · net {fmtRs(fbr.divTotals.net)}</span>
              </div>
            )}
          </Card>
          <Card>
            <div className="label-cap mb-2">Capital gains — FIFO disposals ({fbr.year.label})</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Stat label="Net gain" value={fmtSignedRs(fbr.cgt.netGain)} tone={fbr.cgt.netGain >= 0 ? "positive" : "negative"} />
              <Stat label={`CGT @ ${fbr.cgt.rate}%`} value={fmtRs(fbr.cgt.cgt)} tone="accent" />
              <Stat label="Long-term" value={fmtSignedRs(fbr.cgt.longTermGain)} tone="muted" hint="held > 365d" />
              <Stat label="Short-term" value={fmtSignedRs(fbr.cgt.shortTermGain)} tone="muted" />
            </div>
            <Table columns={disposalCols} rows={fbr.disposals} rowKey={(d) => `${d.symbol}-${d.soldDate}-${d.acquired}-${d.shares}`} empty="No disposals in this tax year." />
          </Card>
        </div>
      </Section>

      <Section
        number="07"
        title="Savings profit — the tax you don't see"
        display={`Profit on debt, withheld at ${podWht}%`}
        description="Bank profit is 'profit on debt' (Sec 151): the bank withholds before it reaches your account, and for most individuals that is the final tax. The accrual on your Assets page is GROSS — this is the haircut at your current balances and rates."
      >
        {savingsAccts.length === 0 ? (
          <Card><p className="text-sm text-muted">No savings accounts tracked yet — add one on the Assets page.</p></Card>
        ) : (
          <Table
            columns={[
              { key: "n", header: "Account", render: (a: any) => <div><div className="font-medium text-[13px]">{a.name}</div><div className="text-[11px] text-muted">{a.bank}</div></div> },
              { key: "bal", header: "Balance (accrued)", align: "right", mono: true, render: (a: any) => fmtRs(a.balance) },
              { key: "rate", header: "Rate", align: "right", mono: true, render: (a: any) => `${Number(a.ratePercent).toFixed(2)}%` },
              { key: "gross", header: "Profit / yr", align: "right", mono: true, render: (a: any) => fmtRs((a.balance * a.ratePercent) / 100) },
              { key: "wht", header: `WHT @ ${podWht}%`, align: "right", mono: true, render: (a: any) => <span style={{ color: "var(--negative)" }}>-{fmtRs(((a.balance * a.ratePercent) / 100) * (podWht / 100))}</span> },
              { key: "net", header: "Net / yr", align: "right", mono: true, render: (a: any) => <span style={{ color: "var(--positive)" }}>{fmtRs(((a.balance * a.ratePercent) / 100) * (1 - podWht / 100))}</span> },
            ]}
            rows={savingsAccts as any[]}
            rowKey={(a: any) => a._id}
            empty=""
          />
        )}
      </Section>
    </div>
  );
}
