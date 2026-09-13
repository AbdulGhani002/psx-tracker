import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { NetWorthChart } from "@/components/dashboard/NetWorthChart";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { HoldingsTable, type HoldingRow } from "@/app/holdings/HoldingsTable";
import { getPortfolioSummary, checkDataAvailability, getSparklines, getShariahStatus, getAllTransactions, getFbrPack } from "@/lib/data";
import { getToday, getAllocation } from "@/lib/analytics/dashboard";
import { getPriceFreshness } from "@/lib/prices";
import { currentTaxYear } from "@/lib/dates";
import { fmtRs, fmtSignedRs } from "@/lib/format";

const STALE_AFTER_DAYS = 7;

// The Holding tab: ten figures, the market value line beside the holdings
// donut, then the table of positions.
export async function HoldingTab() {
  const [avail, summary, today, alloc, txs] = await Promise.all([checkDataAvailability(), getPortfolioSummary(), getToday(), getAllocation(), getAllTransactions()]);
  const cur = currentTaxYear();
  const pack = await getFbrPack(cur.endYear).catch(() => null);
  const held = summary.positions.filter((p) => p.shares > 0);
  const [freshness, spark, shariah] = await Promise.all([getPriceFreshness(held.map((p) => p.symbol)), getSparklines(held.map((r) => r.symbol)), getShariahStatus().catch(() => null)]);
  const shariahBySym = new Map((shariah?.holdings ?? []).map((h) => [h.symbol, (h.compliant === null ? null : h.inKmi30 ? "KMI30" : h.inKmiAllShare ? "KMIALL" : "NON") as HoldingRow["shariah"]]));
  const byName = new Map(today.names.map((n) => [n.symbol, n]));

  const dividendTax = txs.filter((t) => t.type === "DIVIDEND").reduce((s, t) => s + (t.taxDeducted ?? 0), 0);
  const fees = txs.filter((t) => t.type === "BUY" || t.type === "SELL" || t.type === "RIGHT").reduce((s, t) => s + (t.fees ?? 0), 0);
  const totalReturn = summary.unrealizedPL + summary.realizedPL + summary.dividendsTotal;
  const pct = (v: number, base: number) => (base > 0 ? `${v >= 0 ? "+" : ""}${((v / base) * 100).toFixed(2)}%` : undefined);

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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 stagger">
        <StatCard label="Investment value" value={fmtRs(summary.totalCost)} />
        <StatCard label="Unrealized gain/loss" value={fmtSignedRs(summary.unrealizedPL)} tone={summary.unrealizedPL >= 0 ? "positive" : "negative"} delta={pct(summary.unrealizedPL, summary.totalCost)} deltaTone={summary.unrealizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Today's return" value={fmtSignedRs(today.profit)} tone={today.profit >= 0 ? "positive" : "negative"} delta={`${today.profitPct >= 0 ? "+" : ""}${today.profitPct.toFixed(2)}%`} deltaTone={today.profit >= 0 ? "positive" : "negative"} />
        <StatCard label="Dividends" value={fmtRs(summary.dividendsTotal)} action={<Link href="/portfolio?tab=payouts" className="text-[11px] link-underline whitespace-nowrap">View details</Link>} />
        <StatCard label="Dividend tax" value={fmtRs(dividendTax)} />
        <StatCard label="Available cash" value={fmtRs(alloc.availableCash)} />
        <StatCard label="Realized gain/loss" value={fmtSignedRs(summary.realizedPL)} tone={summary.realizedPL >= 0 ? "positive" : "negative"} />
        <StatCard label="Total return" value={fmtSignedRs(totalReturn)} tone={totalReturn >= 0 ? "positive" : "negative"} delta={pct(totalReturn, summary.totalCost)} deltaTone={totalReturn >= 0 ? "positive" : "negative"} />
        <StatCard label="Deductions" value={fmtRs(fees)} hint="Brokerage and levies on trades" />
        <StatCard label={`CGT (${cur.label})`} value={pack ? fmtRs(pack.cgt.cgt) : "–"} hint={pack ? `${pack.cgt.rate}% on ${fmtSignedRs(pack.cgt.netGain)} net gain` : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2 min-h-[340px]">
          <NetWorthChart title="Market value" value={summary.totalValue} />
        </div>
        <Card title="Holdings" action={<span className="text-[12px] text-muted">{held.length} positions</span>}>
          <AllocationDonut slices={held.map((p) => ({ label: p.symbol, value: p.marketValue }))} maxSlices={8} centerValue={String(held.length)} centerLabel="names" />
        </Card>
      </div>

      <Card className="mt-3">
        <HoldingsTable rows={rows} staleAfterDays={STALE_AFTER_DAYS} />
        {shariah && shariah.totalValue > 0 && (
          <p className="mt-4 text-[12px] text-muted leading-relaxed">
            KMI screen: <span className="mono-num">{Math.round((shariah.compliantValue / shariah.totalValue) * 100)}%</span> of your equity value sits in KMI index members.
            {shariah.totalPurification > 0 && <> Purification due on {shariah.taxYearLabel} dividends: <span className="mono-num">Rs {Math.round(shariah.totalPurification).toLocaleString("en-PK")}</span>.</>} Membership of the Meezan-screened KMI indices is a proxy for the full screen, not a fatwa.
          </p>
        )}
      </Card>
    </div>
  );
}
