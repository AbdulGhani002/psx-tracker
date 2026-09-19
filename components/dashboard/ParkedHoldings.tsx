import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { ParkButton } from "@/components/ui/ParkButton";
import { fmtRs, fmtNum } from "@/lib/format";
import type { PositionRow } from "@/lib/calculations/portfolio";

// The holdings kept only for the companies' reports and notices: listed on
// their own, valued, and outside every figure of the portfolio.
export function ParkedHoldings({ rows, notes = {} }: { rows: PositionRow[]; notes?: Record<string, string> }) {
  const live = rows.filter((r) => r.shares > 0);
  if (live.length === 0) return null;
  const value = live.reduce((s, r) => s + r.marketValue, 0);
  return (
    <Card title="Parked" eyebrow="Kept for the companies' reports, not counted" action={<span className="mono-num text-[12px] text-muted">{fmtRs(value)}</span>}>
      <div className="hairline-list">
        {live.map((r) => (
          <div key={r.symbol} className="flex items-center gap-3">
            <CompanyMark symbol={r.symbol} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <Link href={`/holdings/${r.symbol}`} className="font-semibold text-[13px] hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                <span className="text-[12px] text-muted truncate">{r.name}</span>
              </div>
              <div className="text-[11px] text-muted">
                {fmtNum(r.shares)} {r.shares === 1 ? "share" : "shares"}{r.priceKnown ? ` · ${fmtRs(r.currentPrice, true)} · ${fmtRs(r.marketValue)}` : " · no price"}
                {notes[r.symbol] ? ` · ${notes[r.symbol]}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href={`/transactions/new?symbol=${r.symbol}&type=SELL&shares=${r.shares}`} className="btn-ghost !py-[5px] !px-3 !text-[12px]">Sell</Link>
              <ParkButton symbol={r.symbol} parked />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-muted mt-3">These shares sit outside the holdings table, the totals, the weights, the rebalance and the reports. Announcements from these companies still arrive, and dividends they pay are still recorded.</p>
    </Card>
  );
}
