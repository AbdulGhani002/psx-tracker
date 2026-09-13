import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { TransactionsView } from "@/app/transactions/TransactionsView";
import { getAllTransactions, getAllHoldings, getCorporateActionSuggestions, getFbrPack } from "@/lib/data";
import { currentTaxYear } from "@/lib/dates";
import { fmtRs, fmtSignedRs, fmtDate, fmtNum } from "@/lib/format";

// Trade history: what was closed and what it made, then the whole ledger.
export async function TradesTab() {
  const cur = currentTaxYear();
  const [transactions, holdings, corpActions, pack] = await Promise.all([getAllTransactions(), getAllHoldings(), getCorporateActionSuggestions().catch(() => []), getFbrPack(cur.endYear).catch(() => null)]);
  const buys = transactions.filter((t) => t.type === "BUY" || t.type === "RIGHT");
  const sells = transactions.filter((t) => t.type === "SELL");
  const bought = buys.reduce((s, t) => s + t.netAmount, 0);
  const sold = sells.reduce((s, t) => s + t.netAmount, 0);
  const fees = transactions.reduce((s, t) => s + (t.fees ?? 0), 0);
  const realized = pack ? pack.cgt.netGain : null;

  // Realised by month for the closed trades of this tax year.
  const byMonth = new Map<string, number>();
  for (const d of pack?.disposals ?? []) {
    const k = new Date(d.soldDate).toISOString().slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + d.gain);
  }
  const months = [...byMonth.entries()].sort();

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        <StatCard label="Bought" value={fmtRs(bought)} hint={`${buys.length} buys and rights`} />
        <StatCard label="Sold" value={fmtRs(sold)} hint={`${sells.length} sells`} />
        <StatCard label={`Realised gain, ${cur.label}`} value={realized != null ? fmtSignedRs(realized) : "–"} tone={realized != null ? (realized >= 0 ? "positive" : "negative") : "muted"} hint={pack ? `${pack.disposals.length} closed lot${pack.disposals.length === 1 ? "" : "s"}` : undefined} />
        <StatCard label="Fees and levies" value={fmtRs(fees)} hint="Brokerage, SST and CDC on every trade" />
      </div>

      {corpActions.length > 0 && (
        <Card className="mt-3" eyebrow="Announced" title="Entitlements waiting to be recorded">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {corpActions.map((c) => (
              <div key={`${c.symbol}-${c.type}-${c.bookClosure}`} className="rounded-lg border border-[var(--rule)] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{c.symbol}</span>
                  <span className="pill" data-tone="positive">{c.type === "BONUS" ? "Bonus" : "Right"} {c.pct}%</span>
                </div>
                <p className="text-[12.5px] mt-2 text-muted">
                  Book closure <span className="mono-num text-ink">{c.bookClosure}</span>. On your <span className="mono-num text-ink">{c.heldShares.toLocaleString()}</span> shares that is <span className="mono-num font-semibold text-ink">{c.suggestedShares.toLocaleString()}</span> new shares.
                </p>
                <Link href={`/transactions/new?symbol=${c.symbol}&type=${c.type}&shares=${c.suggestedShares}&date=${c.bookClosure}`} className="btn-ghost !py-1 text-[12px] mt-2">Record it</Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pack && pack.disposals.length > 0 && (
        <Card className="mt-3" title="Closed trades" eyebrow={`${cur.label}, FIFO: each sale matched to the oldest lots it consumed`} action={<Link href="/portfolio?tab=cgt" className="text-[12px] link-underline">CGT</Link>}>
          {months.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {months.map(([k, v]) => (
                <span key={k} className="pill" data-tone={v >= 0 ? "positive" : "negative"}>{k} {fmtSignedRs(v)}</span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr><th>Symbol</th><th className="text-right">Quantity</th><th className="text-right">Buy price</th><th className="text-right">Sale price</th><th className="text-right">Total cost</th><th className="text-right">Total value</th><th className="text-right">Realized P&amp;L</th><th>Close date</th><th>Held</th></tr>
              </thead>
              <tbody>
                {pack.disposals.map((d, i) => (
                  <tr key={i}>
                    <td><Link href={`/holdings/${d.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{d.symbol}</Link><div className="text-[11px] text-muted">bought {fmtDate(d.acquired)}</div></td>
                    <td className="text-right mono-num">{fmtNum(d.shares)}</td>
                    <td className="text-right mono-num">{d.shares > 0 ? (d.cost / d.shares).toFixed(2) : "–"}</td>
                    <td className="text-right mono-num">{d.shares > 0 ? (d.proceeds / d.shares).toFixed(2) : "–"}</td>
                    <td className="text-right mono-num">{fmtRs(d.cost)}</td>
                    <td className="text-right mono-num">{fmtRs(d.proceeds)}</td>
                    <td className="text-right mono-num" style={{ color: d.gain >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(d.gain)}<div className="text-[11px] opacity-80">{d.cost > 0 ? `${d.gain >= 0 ? "+" : ""}${((d.gain / d.cost) * 100).toFixed(2)}%` : ""}</div></td>
                    <td className="text-muted">{fmtDate(d.soldDate)}</td>
                    <td className="text-muted">{d.holdingDays}d{d.longTerm ? " · long" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-3" title="Trade history" eyebrow={`${transactions.length.toLocaleString()} records`}>
        <TransactionsView transactions={transactions} symbols={holdings.map((h) => h.symbol)} />
      </Card>
    </div>
  );
}
