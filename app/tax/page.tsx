import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Stat, StatRow } from "@/components/ui/Stat";
import { getFbrPack, getAllTransactions, getAppSettings, getNetWorth, getCashSummary } from "@/lib/data";
import { currentTaxYear, taxYearOf } from "@/lib/dates";
import { whtPct } from "@/lib/calculations/pk-tax";
import { fmtRs, fmtSignedRs, fmtDate, fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";

// Capital gains, withholding and zakat for a tax year (July to June), from
// the recorded warrants and the FIFO lots the app keeps. The filing pack in
// the Statement page prints the same figures; this is the screen version.

export default async function TaxPage({ searchParams }: { searchParams?: { fy?: string } }) {
  const requested = Number(searchParams?.fy);
  const cur = currentTaxYear();
  const endYear = Number.isFinite(requested) && requested > 2000 ? requested : cur.endYear;
  const [pack, txs, settings, nw, cashSum] = await Promise.all([getFbrPack(endYear), getAllTransactions(), getAppSettings(), getNetWorth().catch(() => null), getCashSummary().catch(() => null)]);
  const years = [...new Set([...pack.years, cur.endYear, cur.endYear - 1])].sort((a, b) => b - a);
  const cgtRate = whtPct("capital-gain", settings as any);
  const divRate = whtPct("dividend", settings as any);
  const filer = (settings as any).filerStatus !== "non-filer";

  // Deductions actually paid this year: brokerage and levies on trades, tax
  // withheld on dividends, zakat deducted at source.
  const inYear = txs.filter((t) => taxYearOf(t.date).endYear === endYear);
  const brokerage = inYear.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "RIGHT").reduce((s, t) => s + (t.fees ?? 0), 0);
  const tradesCount = inYear.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "RIGHT").length;
  const traded = inYear.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "RIGHT").reduce((s, t) => s + t.totalAmount, 0);

  // Zakat: 2.5% of what is zakatable today. Shares held for trading and all
  // cash-like assets count in full; nothing here nets out debts, and the
  // date that matters is your own zakat anniversary, so this is an estimate.
  const brokerCash = Math.max(0, cashSum?.balance ?? 0);
  const zakatBase = nw ? nw.equity + nw.funds + nw.savings + brokerCash : 0;
  const zakatDue = zakatBase * 0.025;
  const zakatDeductedAtSource = inYear.filter((t) => t.type === "DIVIDEND").reduce((s, t) => s + (t.zakatDeducted ?? 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">Tax &amp; Zakat</h1>
          <div className="text-[12px] text-muted mt-0.5">
            {pack.year.fbrName} ({pack.year.label}), from your recorded warrants and FIFO lots. You are set as a {filer ? "filer" : "non-filer"}: CGT {cgtRate}%, dividend withholding {divRate}%.{" "}
            <Link href="/settings" className="link-underline">Change</Link>
          </div>
        </div>
        <div className="seg">
          {years.map((y) => (
            <Link key={y} href={`/tax?fy=${y}`} className="px-2.5 py-1 rounded-lg text-[12px] font-medium" style={{ background: y === endYear ? "var(--surface)" : "transparent", color: y === endYear ? "var(--ink)" : "var(--muted)" }}>
              TY{y}
            </Link>
          ))}
        </div>
      </div>

      <StatRow>
        <Stat label="Net capital gain" value={fmtSignedRs(pack.cgt.netGain)} size="lg" tone={pack.cgt.netGain >= 0 ? "positive" : "negative"} hint={`Long term ${fmtSignedRs(pack.cgt.longTermGain)} · short term ${fmtSignedRs(pack.cgt.shortTermGain)}`} />
        <Stat label={`CGT at ${pack.cgt.rate}%`} value={fmtRs(pack.cgt.cgt)} size="lg" tone="negative" hint={cashSum && cashSum.cgtWithheld > 0 ? `Held back from sale proceeds so far: ${fmtRs(cashSum.cgtWithheld)}` : "NCCPL collects it after the sale, not at settlement"} />
        <Stat label="Dividends, gross" value={fmtRs(pack.divTotals.gross)} size="lg" hint={`Withheld ${fmtRs(pack.divTotals.wht)} · zakat ${fmtRs(pack.divTotals.zakat)} · net ${fmtRs(pack.divTotals.net)}`} />
        <Stat label="Brokerage and levies" value={fmtRs(brokerage)} size="lg" tone="muted" hint={`${tradesCount} trades, ${fmtRs(traded)} traded`} />
        <Stat label="Zakat, 2.5% of today's base" value={fmtRs(zakatDue)} size="lg" hint={`On ${fmtRs(zakatBase)}: shares, funds, savings and brokerage cash. Deducted at source this year: ${fmtRs(zakatDeductedAtSource)}`} />
      </StatRow>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-6">
        <div className="xl:col-span-2">
          <Card title="Disposals" eyebrow="FIFO: each sale matched to the oldest lots it consumed">
            {pack.disposals.length === 0 ? (
              <div className="text-[12px] text-muted">No sales in this tax year.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-zar">
                  <thead>
                    <tr><th>Sold</th><th>Name</th><th>Acquired</th><th className="text-right">Shares</th><th className="text-right">Cost</th><th className="text-right">Proceeds</th><th className="text-right">Gain</th><th>Held</th></tr>
                  </thead>
                  <tbody>
                    {pack.disposals.map((d, i) => (
                      <tr key={i}>
                        <td>{fmtDate(d.soldDate)}</td>
                        <td className="font-medium">{d.symbol}</td>
                        <td className="text-muted">{fmtDate(d.acquired)}</td>
                        <td className="text-right font-mono mono-num">{fmtNum(d.shares)}</td>
                        <td className="text-right font-mono mono-num">{fmtRs(d.cost)}</td>
                        <td className="text-right font-mono mono-num">{fmtRs(d.proceeds)}</td>
                        <td className="text-right font-mono mono-num" style={{ color: d.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(d.gain)}</td>
                        <td className="text-muted">{d.holdingDays}d{d.longTerm ? " · long" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <Card title="Dividends by name" eyebrow="Gross, withheld, net">
          {pack.dividends.length === 0 ? (
            <div className="text-[12px] text-muted">No dividends in this tax year.</div>
          ) : (
            <table className="table-zar">
              <thead><tr><th>Name</th><th className="text-right">Gross</th><th className="text-right">WHT</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {pack.dividends.map((r) => (
                  <tr key={r.symbol}><td className="font-medium">{r.symbol} <span className="text-[11px] text-muted">×{r.count}</span></td><td className="text-right font-mono mono-num">{fmtRs(r.gross)}</td><td className="text-right font-mono mono-num text-muted">{fmtRs(r.wht)}</td><td className="text-right font-mono mono-num">{fmtRs(r.net)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <Card title="Zakat" eyebrow="An estimate at today's values">
          <table className="table-zar">
            <tbody>
              <tr><td>Shares at market</td><td className="text-right font-mono mono-num">{fmtRs(nw?.equity ?? 0)}</td></tr>
              <tr><td>Money-market funds</td><td className="text-right font-mono mono-num">{fmtRs(nw?.funds ?? 0)}</td></tr>
              <tr><td>Savings</td><td className="text-right font-mono mono-num">{fmtRs(nw?.savings ?? 0)}</td></tr>
              <tr><td>Brokerage cash</td><td className="text-right font-mono mono-num">{fmtRs(brokerCash)}</td></tr>
              <tr><td className="font-semibold">Zakatable base</td><td className="text-right font-mono mono-num font-semibold">{fmtRs(zakatBase)}</td></tr>
              <tr><td className="font-semibold">Zakat at 2.5%</td><td className="text-right font-mono mono-num font-semibold" style={{ color: "var(--accent-deep)" }}>{fmtRs(zakatDue)}</td></tr>
            </tbody>
          </table>
          <p className="text-[12px] text-muted mt-3 leading-relaxed">
            Zakat falls due on your own anniversary date at that day's values, on what you have held for a lunar year, less debts due. Companies and funds deduct 2.5% from payouts at source unless a declaration is on file (your MCB account shows one), so deducted amounts here are what was already paid.
          </p>
        </Card>
        <Card title="Deductions this year" eyebrow="What left the account besides the price">
          <table className="table-zar">
            <tbody>
              <tr><td>Brokerage commission and SST on trades</td><td className="text-right font-mono mono-num">{fmtRs(brokerage)}</td></tr>
              <tr><td>Withholding on dividends ({divRate}%)</td><td className="text-right font-mono mono-num">{fmtRs(pack.divTotals.wht)}</td></tr>
              <tr><td>Zakat deducted at source</td><td className="text-right font-mono mono-num">{fmtRs(pack.divTotals.zakat)}</td></tr>
              <tr><td>Capital gains tax due on this year's sales ({pack.cgt.rate}%)</td><td className="text-right font-mono mono-num">{fmtRs(pack.cgt.cgt)}</td></tr>
              <tr><td className="font-semibold">Total</td><td className="text-right font-mono mono-num font-semibold">{fmtRs(brokerage + pack.divTotals.wht + pack.divTotals.zakat + pack.cgt.cgt)}</td></tr>
            </tbody>
          </table>
          <p className="text-[12px] text-muted mt-3 leading-relaxed">
            The filing pack for a completed year, with the 30 June holdings at FIFO cost for the wealth statement, is on the <Link href="/report" className="link-underline">Statement</Link> page.
          </p>
        </Card>
      </div>
    </div>
  );
}
