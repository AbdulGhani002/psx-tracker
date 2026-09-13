import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { getFbrPack, getAllTransactions, getAppSettings, getCashSummary } from "@/lib/data";
import { currentTaxYear, taxYearOf } from "@/lib/dates";
import { whtPct } from "@/lib/calculations/pk-tax";
import { fmtRs, fmtSignedRs, fmtDate, fmtNum } from "@/lib/format";
import type { PortfolioSearch } from "../page";

// Capital gains tax for a tax year (July to June), from the FIFO lots the app
// keeps: each disposal, its slab and the tax on it, then the deductions.
export async function CgtTab({ search }: { search: PortfolioSearch }) {
  const requested = Number(search?.fy);
  const cur = currentTaxYear();
  const endYear = Number.isFinite(requested) && requested > 2000 ? requested : cur.endYear;
  const [pack, txs, settings, cashSum] = await Promise.all([getFbrPack(endYear), getAllTransactions(), getAppSettings(), getCashSummary().catch(() => null)]);
  const years = [...new Set([...pack.years, cur.endYear, cur.endYear - 1])].sort((a, b) => b - a);
  const filer = (settings as any).filerStatus !== "non-filer";
  const divRate = whtPct("dividend", settings as any);
  const inYear = txs.filter((t) => taxYearOf(t.date).endYear === endYear);
  const trades = inYear.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "RIGHT");
  const brokerage = trades.reduce((s, t) => s + (t.fees ?? 0), 0);
  const totalLoss = pack.disposals.filter((d) => d.gain < 0).reduce((s, d) => s + d.gain, 0);
  const totalGain = pack.disposals.filter((d) => d.gain > 0).reduce((s, d) => s + d.gain, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-semibold">Tax deductions</span>
          <span className="pill" data-tone={filer ? "positive" : "negative"}>{filer ? "Filer" : "Non-filer"}</span>
          <Link href="/settings" className="text-[12px] link-underline">Update filer status</Link>
        </div>
        <div className="seg">
          {years.map((y) => (
            <Link key={y} href={`/portfolio?tab=cgt&fy=${y}`} data-active={y === endYear}>TY{y}</Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Net capital gain" value={fmtSignedRs(pack.cgt.netGain)} tone={pack.cgt.netGain >= 0 ? "positive" : "negative"} hint={`Long term ${fmtSignedRs(pack.cgt.longTermGain)} · short term ${fmtSignedRs(pack.cgt.shortTermGain)}`} />
        <StatCard label={`CGT at ${pack.cgt.rate}%`} value={fmtRs(pack.cgt.cgt)} tone="negative" hint={cashSum && cashSum.cgtWithheld > 0 ? `Held back from proceeds so far: ${fmtRs(cashSum.cgtWithheld)}` : "NCCPL collects it after the sale"} />
        <StatCard label="Dividend withholding" value={fmtRs(pack.divTotals.wht)} hint={`${divRate}% on ${fmtRs(pack.divTotals.gross)} gross`} />
        <StatCard label="Brokerage and levies" value={fmtRs(brokerage)} hint={`${trades.length} trades this year`} />
      </div>

      <Card className="mt-3" title="System-calculated tax" eyebrow={`${pack.year.fbrName} (${pack.year.label}); each sale matched to the oldest lots it consumed`}>
        {pack.disposals.length === 0 ? (
          <div className="text-[12px] text-muted">No sales in this tax year.</div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr><th>Symbol</th><th>Date</th><th className="text-right">Quantity</th><th className="text-right">Cost</th><th className="text-right">Proceeds</th><th className="text-right">Gain/loss</th><th className="text-right">CGT slab</th><th className="text-right">CGT (tax)</th><th>Held</th></tr>
              </thead>
              <tbody>
                {pack.disposals.map((d, i) => {
                  const tax = d.gain > 0 ? (d.gain * pack.cgt.rate) / 100 : 0;
                  return (
                    <tr key={i}>
                      <td><Link href={`/holdings/${d.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{d.symbol}</Link></td>
                      <td className="mono-num text-muted">{fmtDate(d.soldDate)}</td>
                      <td className="text-right mono-num">{fmtNum(d.shares)}</td>
                      <td className="text-right mono-num">{fmtRs(d.cost)}</td>
                      <td className="text-right mono-num">{fmtRs(d.proceeds)}</td>
                      <td className="text-right mono-num" style={{ color: d.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(d.gain)}</td>
                      <td className="text-right mono-num">{pack.cgt.rate}%</td>
                      <td className="text-right mono-num" style={{ color: tax > 0 ? "var(--negative)" : "var(--muted)" }}>{tax > 0 ? fmtRs(tax) : "–"}</td>
                      <td className="text-muted">{d.holdingDays}d{d.longTerm ? " · long" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-8 mt-4 text-right">
          <div><div className="mono-num font-semibold" style={{ color: "var(--positive)" }}>{fmtRs(totalGain)}</div><div className="text-[11px] text-muted">Total gain</div></div>
          <div><div className="mono-num font-semibold" style={{ color: "var(--negative)" }}>{fmtRs(Math.abs(totalLoss))}</div><div className="text-[11px] text-muted">Total loss</div></div>
          <div><div className="mono-num font-semibold">{fmtRs(pack.cgt.cgt)}</div><div className="text-[11px] text-muted">Net CGT payable</div></div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Dividends by name" eyebrow="Gross, withheld, net, this tax year">
          {pack.dividends.length === 0 ? (
            <div className="text-[12px] text-muted">No dividends in this tax year.</div>
          ) : (
            <table className="table-zar">
              <thead><tr><th>Name</th><th className="text-right">Gross</th><th className="text-right">WHT</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {pack.dividends.map((r) => (
                  <tr key={r.symbol}><td className="font-semibold">{r.symbol} <span className="text-[11px] text-muted font-normal">×{r.count}</span></td><td className="text-right mono-num">{fmtRs(r.gross)}</td><td className="text-right mono-num text-muted">{fmtRs(r.wht)}</td><td className="text-right mono-num">{fmtRs(r.net)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Deductions this year" eyebrow="What left the account besides the price">
          <table className="table-zar">
            <tbody>
              <tr><td>Brokerage commission and SST on trades</td><td className="text-right mono-num">{fmtRs(brokerage)}</td></tr>
              <tr><td>Withholding on dividends ({divRate}%)</td><td className="text-right mono-num">{fmtRs(pack.divTotals.wht)}</td></tr>
              <tr><td>Zakat deducted at source</td><td className="text-right mono-num">{fmtRs(pack.divTotals.zakat)}</td></tr>
              <tr><td>Capital gains tax on this year&apos;s sales ({pack.cgt.rate}%)</td><td className="text-right mono-num">{fmtRs(pack.cgt.cgt)}</td></tr>
              <tr><td className="font-semibold">Total</td><td className="text-right mono-num font-semibold">{fmtRs(brokerage + pack.divTotals.wht + pack.divTotals.zakat + pack.cgt.cgt)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
