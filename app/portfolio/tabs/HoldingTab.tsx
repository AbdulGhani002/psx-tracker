import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { NetWorthChart } from "@/components/dashboard/NetWorthChart";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { HoldingsTable, type HoldingRow } from "@/app/holdings/HoldingsTable";
import { ParkedHoldings } from "@/components/dashboard/ParkedHoldings";
import { getPortfolioSummary, checkDataAvailability, getSparklines, getShariahStatus, getAllTransactions, getFbrPack, getAllHoldings } from "@/lib/data";
import { getToday, getAllocation, getBookFigures, getDollarized, getUsdPkrSeries } from "@/lib/analytics/dashboard";
import { holdingDollars } from "@/lib/analytics/dollarized";
import { getFyProfits } from "@/lib/analytics/fy";
import { getPriceFreshness } from "@/lib/prices";
import { currentTaxYear } from "@/lib/dates";
import { fmtRs, fmtSignedRs, fmtDollars, fmtSignedDollars } from "@/lib/format";

const STALE_AFTER_DAYS = 7;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4) !== new Date().toISOString().slice(0, 4) ? " " + iso.slice(0, 4) : ""}`;
const signedPct = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;

// The Holding tab: twelve figures (the last two in dollars), the profit of
// this financial year and the last, the market value line beside the
// holdings donut, then the table of positions.
export async function HoldingTab() {
  const [avail, summary, today, alloc, txs, book, allHoldings, dz, usdRates] = await Promise.all([checkDataAvailability(), getPortfolioSummary(), getToday(), getAllocation(), getAllTransactions(), getBookFigures(), getAllHoldings(), getDollarized().catch(() => null), getUsdPkrSeries()]);
  const fy = await getFyProfits().catch(() => null);
  const parkedNotes = Object.fromEntries(allHoldings.filter((h) => h.parked && h.parkedNote).map((h) => [h.symbol, h.parkedNote as string]));
  const cur = currentTaxYear();
  const pack = await getFbrPack(cur.endYear).catch(() => null);
  const held = summary.positions.filter((p) => p.shares > 0);
  const [freshness, spark, shariah] = await Promise.all([getPriceFreshness(held.map((p) => p.symbol)), getSparklines(held.map((r) => r.symbol)), getShariahStatus().catch(() => null)]);
  const shariahBySym = new Map((shariah?.holdings ?? []).map((h) => [h.symbol, (h.compliant === null ? null : h.inKmi30 ? "KMI30" : h.inKmiAllShare ? "KMIALL" : "NON") as HoldingRow["shariah"]]));
  const byName = new Map(today.names.map((n) => [n.symbol, n]));

  const dividendTax = txs.filter((t) => t.type === "DIVIDEND").reduce((s, t) => s + (t.taxDeducted ?? 0), 0);
  const fees = txs.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "RIGHT").reduce((s, t) => s + (t.fees ?? 0), 0);
  const pct = (v: number, base: number) => (base > 0 ? `${v >= 0 ? "+" : ""}${((v / base) * 100).toFixed(2)}%` : undefined);
  const hasFunds = book.funds.count > 0 || book.savings.balance > 0;
  const unrealizedAll = book.equity.unrealized + book.funds.gain + book.savings.profit;

  const rows: HoldingRow[] = held.map((r) => {
    const f = freshness.get(r.symbol);
    const d = byName.get(r.symbol);
    return {
      symbol: r.symbol,
      name: r.name ?? "",
      sector: r.sector ?? "",
      shares: r.shares,
      avgCost: r.avgCost,
      price: r.currentPrice,
      priceKnown: r.priceKnown,
      marketValue: r.marketValue,
      unrealizedPL: r.unrealizedPL,
      unrealizedPct: r.unrealizedPct,
      dividendsReceived: r.dividendsReceived,
      totalCost: r.totalCost,
      currentPercent: r.currentPercent,
      targetPercent: r.targetPercent,
      deviation: r.deviation,
      staleDays: f ? f.ageDays : null,
      spark: spark[r.symbol] ?? [],
      todayPct: d ? d.changePct / 100 : null,
      todayProfit: d ? d.profit : null,
      shariah: shariahBySym.get(r.symbol) ?? null,
      usd: (() => {
        const hd = holdingDollars(txs.filter((t) => t.symbol === r.symbol), r.marketValue, usdRates);
        return hd ? { total: hd.totalUsd, totalPct: hd.totalPct, costUsd: hd.costUsd, valueUsd: hd.valueUsd, rateNow: hd.rateNow } : null;
      })(),
    };
  });

  return (
    <div>
      {!avail.available && <SetupBanner reason={avail.reason} />}
      {summary.unpricedSymbols.length > 0 && (
        <div className="card card-pad mb-3 text-[13px]">
          <span className="font-semibold">No price for {summary.unpricedSymbols.join(", ")}.</span> <span className="text-muted">Market value, unrealised P&amp;L and weights leave {summary.unpricedSymbols.length === 1 ? "it" : "them"} out.</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 stagger">
        <StatCard label="Investment value" value={fmtRs(book.costBasis)} hint={`What you hold cost${hasFunds ? `: shares ${fmtRs(book.equity.cost)} · funds ${fmtRs(book.funds.cost + book.savings.principal)}` : ""} · money put in, net ${fmtRs(book.invested)}`} />
        <StatCard label="Unrealized gain/loss" value={fmtSignedRs(unrealizedAll)} tone={unrealizedAll >= 0 ? "positive" : "negative"} delta={pct(unrealizedAll, book.costBasis)} deltaTone={unrealizedAll >= 0 ? "positive" : "negative"} hint={hasFunds ? `Shares ${fmtSignedRs(book.equity.unrealized)} · funds ${fmtSignedRs(book.funds.gain + book.savings.profit)}` : undefined} />
        <StatCard label="Today's return" value={fmtSignedRs(book.todayProfit)} tone={book.todayProfit >= 0 ? "positive" : "negative"} delta={book.todayPct != null ? `${book.todayPct >= 0 ? "+" : ""}${book.todayPct.toFixed(2)}%` : undefined} deltaTone={book.todayProfit >= 0 ? "positive" : "negative"} hint={hasFunds ? `Shares ${fmtSignedRs(book.equity.todayProfit)} · funds ${fmtSignedRs(book.funds.perDay)} a day` : undefined} />
        <StatCard label="Dividends" value={fmtRs(summary.dividendsTotal)} action={<Link href="/portfolio?tab=payouts" className="text-[11px] link-underline whitespace-nowrap">View details</Link>} />
        <StatCard label="Dividend tax" value={fmtRs(dividendTax)} />
        <StatCard label="Available cash" value={fmtRs(alloc.availableCash)} />
        <StatCard label="Realized gain/loss" value={fmtSignedRs(summary.realizedPL)} tone={summary.realizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Total return" value={fmtSignedRs(book.totalReturn)} tone={book.totalReturn >= 0 ? "positive" : "negative"} delta={pct(book.totalReturn, book.invested)} deltaTone={book.totalReturn >= 0 ? "positive" : "negative"} hint={`Unrealised ${fmtSignedRs(unrealizedAll)} · realised ${fmtSignedRs(book.equity.realized)} · dividends ${fmtSignedRs(book.equity.dividends)}, on the money put in`} />
        <StatCard label="Deductions" value={fmtRs(fees)} hint="Brokerage and levies on trades" />
        <StatCard label={`CGT (${cur.label})`} value={pack ? fmtRs(pack.cgt.cgt) : "–"} hint={pack ? `${pack.cgt.rate}% on ${fmtSignedRs(pack.cgt.netGain)} net gain` : undefined} />
        <StatCard
          label="Worth in dollars"
          value={dz ? fmtDollars(dz.valueUsd) : "–"}
          hint={dz ? `At Rs ${dz.rateNow.toFixed(2)} a dollar (${dayMonth(dz.rateDate)}) · put in, net: ${fmtDollars(dz.putInUsd)} at each day's rate` : "No USD/PKR rate to hand"}
        />
        <StatCard
          label="Dollarized return"
          value={dz ? fmtSignedDollars(dz.returnUsd) : "–"}
          tone={dz ? (dz.returnUsd >= 0 ? "positive" : "negative") : undefined}
          delta={dz?.returnPct != null ? signedPct(dz.returnPct) : undefined}
          deltaTone={dz ? (dz.returnUsd >= 0 ? "positive" : "negative") : undefined}
          hint={dz && dz.rateFirst && dz.firstDate && dz.rupeePct != null ? `The rupee since your first buy (${dayMonth(dz.firstDate)}): Rs ${dz.rateFirst.toFixed(2)} → Rs ${dz.rateNow.toFixed(2)} a dollar, ${signedPct(dz.rupeePct, 1)}` : undefined}
        />
      </div>

      {fy && fy.years.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          {fy.years.slice(0, 2).map((y) => (
            <StatCard
              key={y.fy.label}
              label={`Profit ${y.fy.label}${y.fy.current ? " so far" : ""}`}
              value={fmtSignedRs(y.profit)}
              tone={y.profit >= 0 ? "positive" : "negative"}
              delta={y.returnPct != null ? signedPct(y.returnPct, 1) : undefined}
              deltaTone={y.profit >= 0 ? "positive" : "negative"}
              hint={`Price gain ${fmtSignedRs(y.capitalGain)} · dividends ${fmtRs(y.dividends)}, a reinvested dividend counted once`}
              action={<Link href="/portfolio?tab=analytics&view=profitability#by-year" className="text-[11px] link-underline whitespace-nowrap">By year</Link>}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2 min-h-[340px]">
          <NetWorthChart title="Market value of shares" value={summary.totalValue} usdRate={dz?.rateNow ?? null} />
        </div>
        <Card title="Holdings" action={<span className="text-[12px] text-muted">{held.length} positions</span>}>
          <AllocationDonut slices={held.map((p) => ({ label: p.symbol, value: p.marketValue }))} maxSlices={8} centerValue={String(held.length)} centerLabel="names" />
        </Card>
      </div>

      <Card className="mt-3">
        <HoldingsTable rows={rows} staleAfterDays={STALE_AFTER_DAYS} />
        {summary.parked.length > 0 && <p className="mt-3 text-[11.5px] text-muted">{summary.parked.filter((p) => p.shares > 0).map((p) => p.symbol).join(", ")} {summary.parked.filter((p) => p.shares > 0).length === 1 ? "is" : "are"} parked and left out of every figure on this page.</p>}
        {shariah && shariah.totalValue > 0 && (
          <p className="mt-4 text-[12px] text-muted leading-relaxed">
            KMI screen: <span className="mono-num">{Math.round((shariah.compliantValue / shariah.totalValue) * 100)}%</span> of your equity value sits in KMI index members.
            {shariah.totalPurification > 0 && <> Purification due on {shariah.taxYearLabel} dividends: <span className="mono-num">Rs {Math.round(shariah.totalPurification).toLocaleString("en-PK")}</span>.</>} Membership of the Meezan-screened KMI indices is a proxy for the full screen, not a fatwa.
          </p>
        )}
      </Card>
      {summary.parked.length > 0 && (
        <div className="mt-3">
          <ParkedHoldings rows={summary.parked} notes={parkedNotes} />
        </div>
      )}
    </div>
  );
}
