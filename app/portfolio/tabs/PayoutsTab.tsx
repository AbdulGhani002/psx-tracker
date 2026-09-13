import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { DividendUploader } from "@/app/dividends/DividendUploader";
import { StackedPayoutBars, AssetBars, type MonthStack } from "@/components/charts/DividendBars";
import { getAllTransactions, getAllHoldings, getDividendForecast } from "@/lib/data";
import { getYields } from "@/lib/analytics/dashboard";
import { getAnnouncedActions } from "@/lib/corporate-actions";
import { cycleLabel } from "@/lib/corporate-actions";
import { fmtRs, fmtDate, fmtNum } from "@/lib/format";
import type { Transaction } from "@/lib/types";

// Payouts, the way Zar shows them: the summary, income over time stacked by
// asset, the total per asset, a month-by-year table, then yields, what is
// coming, and the warrants themselves.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtK = (v: number) => (v >= 1e6 ? `Rs ${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `Rs ${(v / 1e3).toFixed(2)}K` : `Rs ${v.toFixed(0)}`);

export async function PayoutsTab() {
  const [allTx, holdings, yields, forecast, announced] = await Promise.all([getAllTransactions(), getAllHoldings(), getYields().catch(() => null), getDividendForecast().catch(() => null), getAnnouncedActions().catch(() => ({ upcoming: [], recorded: [] }))]);
  const dividends = allTx.filter((t) => t.type === "DIVIDEND");
  const bonuses = allTx.filter((t) => t.type === "BONUS");
  const gross = dividends.reduce((s, t) => s + t.totalAmount, 0);
  const tax = dividends.reduce((s, t) => s + (t.taxDeducted ?? 0), 0);
  const zakat = dividends.reduce((s, t) => s + (t.zakatDeducted ?? 0), 0);
  const net = dividends.reduce((s, t) => s + t.netAmount, 0);

  // Net per month per asset, for the last 24 months; the seven biggest assets
  // get their own colour and the rest fold into Other.
  const byAssetTotal = new Map<string, number>();
  for (const t of dividends) byAssetTotal.set(t.symbol, (byAssetTotal.get(t.symbol) ?? 0) + t.netAmount);
  const ranked = [...byAssetTotal.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 7).map(([s]) => s);
  const assetOf = (s: string) => (top.includes(s) ? s : "Other");
  const assets = ranked.length > 7 ? [...top, "Other"] : top;
  const now = new Date();
  const months: MonthStack[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ month: d.toISOString().slice(0, 7), byAsset: {} });
  }
  const monthIdx = new Map(months.map((m, i) => [m.month, i]));
  for (const t of dividends) {
    const k = new Date(t.date).toISOString().slice(0, 7);
    const i = monthIdx.get(k);
    if (i == null) continue;
    const a = assetOf(t.symbol);
    months[i].byAsset[a] = (months[i].byAsset[a] ?? 0) + t.netAmount;
  }

  // Calendar years down, months across.
  const years = new Map<number, number[]>();
  for (const t of dividends) {
    const d = new Date(t.date);
    const row = years.get(d.getFullYear()) ?? new Array(12).fill(0);
    row[d.getMonth()] += t.netAmount;
    years.set(d.getFullYear(), row);
  }
  const yearRows = [...years.entries()].sort((a, b) => a[0] - b[0]);

  const upcoming = (forecast?.events ?? []).filter((e) => new Date(e.date) >= new Date()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 12);
  const existingWarrants = new Set(dividends.map((t) => t.warrantNo).filter((w): w is string => !!w));
  const existingSymbols = holdings.map((h) => ({ symbol: h.symbol, name: h.name }));

  const columns: Column<Transaction>[] = [
    { key: "date", header: "Payment date", render: (t) => <span className="mono-num text-[12px] text-muted">{fmtDate(t.date)}</span> },
    { key: "symbol", header: "Symbol", render: (t) => <Link href={`/holdings/${t.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{t.symbol}</Link> },
    { key: "type", header: "Type", render: (t) => <Badge tone="positive">{(t.dividendType || "Dividend").replace(/^\w/, (c) => c.toUpperCase())}</Badge> },
    { key: "fy", header: "FY", render: (t) => <span className="mono-num text-[12px] text-muted">{t.financialYear ?? "–"}</span> },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (t) => fmtNum(t.shares) },
    { key: "rate", header: "Rate/share", align: "right", mono: true, render: (t) => t.pricePerShare.toFixed(2) },
    { key: "gross", header: "Gross", align: "right", mono: true, render: (t) => fmtRs(t.totalAmount) },
    { key: "tax", header: "Tax", align: "right", mono: true, render: (t) => <span className="text-muted">{fmtRs(t.taxDeducted ?? 0)}</span> },
    { key: "zakat", header: "Zakat", align: "right", mono: true, render: (t) => <span className="text-muted">{fmtRs(t.zakatDeducted ?? 0)}</span> },
    { key: "net", header: "Net paid", align: "right", mono: true, render: (t) => <span style={{ color: "var(--positive)" }}>{fmtRs(t.netAmount)}</span> },
    { key: "warrant", header: "Warrant", render: (t) => <span className="mono-num text-[11px] text-muted">{t.warrantNo ?? "–"}</span> },
  ];

  return (
    <div>
      <Card className="!py-3 mb-3">
        <div className="text-[14px] font-semibold">Dividend summary</div>
        <div className="text-[12px] text-muted">A breakdown of your earnings: the total received and the portion set aside for taxes and zakat.</div>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Gross dividend" value={fmtRs(gross)} hint={`${dividends.length} warrants`} />
        <StatCard label="Tax" value={fmtRs(tax)} tone="negative" />
        <StatCard label="Zakat" value={fmtRs(zakat)} tone="negative" />
        <StatCard label="Net dividend" value={fmtRs(net)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Dividend income over time" eyebrow="Net dividend per asset per month, last 24 months">
          {dividends.length ? <StackedPayoutBars months={months} assets={assets} /> : <div className="text-[12px] text-muted">No dividends recorded yet.</div>}
        </Card>
        <Card title="Dividends received by asset" eyebrow={`Total net dividends over the life of the portfolio, top ${Math.min(7, ranked.length)} assets`}>
          {ranked.length ? <AssetBars rows={ranked.slice(0, 7).map(([label, value]) => ({ label, value }))} /> : <div className="text-[12px] text-muted">No dividends recorded yet.</div>}
        </Card>
      </div>

      {yearRows.length > 0 && (
        <Card className="mt-3">
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr><th></th>{MONTHS.map((m) => <th key={m} className="text-center">{m}</th>)}<th className="text-right">Year</th></tr>
              </thead>
              <tbody>
                {yearRows.map(([y, row]) => (
                  <tr key={y}>
                    <td className="font-semibold">{y}</td>
                    {row.map((v, i) => <td key={i} className="text-center mono-num text-[12px]" style={{ color: v > 0 ? "var(--positive)" : "var(--faint)" }}>{v > 0 ? fmtK(v) : "–"}</td>)}
                    <td className="text-right mono-num font-semibold" style={{ color: "var(--positive)" }}>{fmtK(row.reduce((s, v) => s + v, 0))}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={13} className="text-right text-muted">Total</td>
                  <td className="text-right mono-num font-semibold" style={{ color: "var(--positive)" }}>{fmtK(net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {yields && yields.rows.length > 0 && (
        <Card className="mt-3" title="Yield by name" eyebrow="Last twelve months per share against today's price and your cost">
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr><th>Name</th><th className="text-right">Shares</th><th className="text-right">12m per share</th><th className="text-right">12m received</th><th className="text-right">Yield on price</th><th className="text-right">Yield on cost</th><th className="text-right">All time</th><th className="text-right">Last paid</th></tr>
              </thead>
              <tbody>
                {yields.rows.map((r) => (
                  <tr key={r.symbol}>
                    <td><Link href={`/holdings/${r.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{r.symbol}</Link> <span className="text-[11px] text-muted">{r.name}</span></td>
                    <td className="text-right mono-num">{r.shares.toLocaleString()}</td>
                    <td className="text-right mono-num">{r.ttmPerShare ? r.ttmPerShare.toFixed(2) : "–"}</td>
                    <td className="text-right mono-num">{r.ttmDividends ? fmtRs(r.ttmDividends) : "–"}</td>
                    <td className="text-right mono-num">{r.yieldOnPricePct ? `${r.yieldOnPricePct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right mono-num">{r.yieldOnCostPct ? `${r.yieldOnCostPct.toFixed(2)}%` : "–"}</td>
                    <td className="text-right mono-num">{r.allTimeDividends ? fmtRs(r.allTimeDividends) : "–"}</td>
                    <td className="text-right text-muted">{r.lastPaid ? fmtDate(r.lastPaid) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(announced.upcoming.length > 0 || announced.recorded.length > 0) && (
        <Card className="mt-3" title="Announced on the exchange" eyebrow="Recorded on the book-closure date from the shares you held; a warrant replaces the figures" action={<Link href="/settings" className="text-[12px] link-underline">Settings</Link>}>
          {announced.upcoming.length > 0 && (
            <div className="overflow-x-auto -mx-2">
              <table className="table-zar">
                <thead><tr><th>Book closure</th><th>Name</th><th>Payout</th><th className="text-right">Shares held</th><th className="text-right">Per share</th><th className="text-right">Gross</th><th className="text-right">Net</th><th>Status</th></tr></thead>
                <tbody>
                  {announced.upcoming.map((a) => (
                    <tr key={`${a.symbol}-${a.type}-${a.bookClosure}`}>
                      <td className="mono-num">{fmtDate(a.bookClosure)}</td>
                      <td><Link href={`/holdings/${a.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{a.symbol}</Link></td>
                      <td>{a.type === "DIVIDEND" ? `${cycleLabel(a.cycle) || "Cash"} dividend ${a.pctOfFace}%` : a.type === "BONUS" ? `Bonus ${a.pctOfFace}%` : `Right ${a.pctOfFace}%`}</td>
                      <td className="text-right mono-num">{a.shares.toLocaleString()}</td>
                      <td className="text-right mono-num">{a.type === "RIGHT" ? "–" : a.type === "BONUS" ? `${a.bonusCredited} sh` : a.rate.toFixed(2)}</td>
                      <td className="text-right mono-num">{a.type === "DIVIDEND" ? fmtRs(a.gross) : "–"}</td>
                      <td className="text-right mono-num" style={{ color: a.type === "DIVIDEND" ? "var(--positive)" : undefined }}>{a.type === "DIVIDEND" ? fmtRs(a.net) : "–"}</td>
                      <td>
                        <span className="pill" data-tone={a.status === "recorded" ? "positive" : a.status === "upcoming" ? "muted" : "negative"}>
                          {a.status === "recorded" ? "Recorded" : a.status === "upcoming" ? (a.type === "RIGHT" ? "Record when subscribed" : "Will record") : a.type === "RIGHT" ? "Subscribe or let lapse" : "Not entitled"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {announced.recorded.length > 0 && (
            <div className="mt-3">
              <div className="text-[12px] text-muted mb-1.5">Recorded automatically, newest first</div>
              <div className="hairline-list">
                {announced.recorded.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <div className="min-w-0 truncate"><span className="font-semibold">{r.symbol}</span> <span className="text-muted">{r.type === "DIVIDEND" ? `dividend ${r.rate.toFixed(2)} x ${r.shares.toLocaleString()}` : `bonus ${r.shares.toLocaleString()} shares`}</span></div>
                    <div className="flex items-center gap-3 shrink-0"><span className="mono-num" style={{ color: r.type === "DIVIDEND" ? "var(--positive)" : undefined }}>{r.type === "DIVIDEND" ? fmtRs(r.net) : ""}</span><span className="text-[11px]" style={{ color: "var(--faint)" }}>{fmtDate(r.date)}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card className="mt-3" title="Expected later" eyebrow="From each name's own payout record; a forecast, not an announcement">
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead><tr><th>Expected</th><th>Name</th><th className="text-right">Per share</th><th className="text-right">Shares</th><th className="text-right">Gross</th><th>Confidence</th></tr></thead>
              <tbody>
                {upcoming.map((e, i) => (
                  <tr key={i}>
                    <td>{fmtDate(e.date)}</td>
                    <td><span className="font-semibold">{e.symbol}</span> <span className="text-[11px] text-muted">{e.name}</span></td>
                    <td className="text-right mono-num">{e.expectedRatePerShare.toFixed(2)}</td>
                    <td className="text-right mono-num">{e.shares.toLocaleString()}</td>
                    <td className="text-right mono-num">{fmtRs(e.expectedGross)}</td>
                    <td><span className="pill" data-tone={e.confidence === "high" ? "positive" : "muted"}>{e.confidence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {bonuses.length > 0 && (
        <Card className="mt-3" title="Bonus shares" eyebrow="Shares received without payment">
          <table className="table-zar">
            <thead><tr><th>Date</th><th>Name</th><th className="text-right">Shares</th><th>Notes</th></tr></thead>
            <tbody>
              {bonuses.slice(0, 20).map((t) => (
                <tr key={String(t._id)}><td>{fmtDate(t.date)}</td><td className="font-semibold">{t.symbol}</td><td className="text-right mono-num">{fmtNum(t.shares)}</td><td className="text-muted">{t.notes}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-3" title="Upload warrants" eyebrow="One or many PDFs at a time; duplicate warrant numbers are skipped">
        <DividendUploader existingSymbols={existingSymbols} existingWarrantNumbers={Array.from(existingWarrants)} />
      </Card>

      <Card className="mt-3" title={`Recorded dividends (${dividends.length})`} eyebrow="Newest first">
        <div className="-mx-2">
          <Table columns={columns} rows={dividends} rowKey={(t) => String(t._id)} empty="No dividends recorded yet." />
        </div>
      </Card>
    </div>
  );
}
