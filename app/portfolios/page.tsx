import Link from "next/link";
import { Sparkline } from "@/components/ui/Sparkline";
import { Card } from "@/components/ui/Card";
import { getPortfolioCards } from "@/lib/analytics/dashboard";
import { fmtRs, fmtSignedRs } from "@/lib/format";

export const dynamic = "force-dynamic";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "P";

// Every portfolio on its own card, each a door into its page.
export default async function PortfoliosPage() {
  const cards = await getPortfolioCards();
  const total = cards.reduce((s, c) => s + c.total, 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-[13px] text-muted">{cards.length} portfolio{cards.length === 1 ? "" : "s"} · <span className="mono-num text-ink font-medium">{fmtRs(total)}</span> together</div>
        <Link href="/settings#portfolios" className="btn-primary">New portfolio</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 stagger">
        {cards.map((c) => (
          <a key={c.portfolio._id} href={`/api/portfolios/select?id=${c.portfolio._id}&next=/portfolio`} className="card card-pad block hover:border-[var(--rule-strong)] transition-colors">
            <div className="flex items-center gap-2.5">
              <span className="initials text-[11px]" style={{ background: `color-mix(in srgb, ${c.portfolio.color} 18%, white)`, color: c.portfolio.color }}>{initials(c.portfolio.name)}</span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold truncate">{c.portfolio.name}</div>
                <div className="text-[11px] text-muted">{c.portfolio.broker || (c.portfolio.isDefault ? "Default portfolio" : "")}{c.names ? ` · ${c.names} names` : ""}</div>
              </div>
            </div>
            <div className="flex items-end justify-between gap-3 mt-3">
              <div>
                <div className="fig text-[19px] whitespace-nowrap">{fmtRs(c.total)}</div>
                <span className="pill mt-1.5" data-tone={c.dayProfit >= 0 ? "positive" : "negative"}>{fmtSignedRs(c.dayProfit)}{c.dayPct != null ? ` (${c.dayPct >= 0 ? "+" : ""}${c.dayPct.toFixed(2)}%)` : ""} today</span>
              </div>
              <Sparkline points={c.spark} width={110} height={34} />
            </div>
            <div className="mini-stats mt-3">
              <div><div className="label">Invested</div><div className="value">{fmtRs(c.invested)}</div></div>
              <div><div className="label">Unrealized</div><div className="value" style={{ color: c.unrealized >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.unrealized)}</div></div>
              <div><div className="label">Total return</div><div className="value" style={{ color: c.totalReturn >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtSignedRs(c.totalReturn)}</div></div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted mt-2">
              <span>Equity {fmtRs(c.equity)}</span><span>Funds {fmtRs(c.funds)}</span><span>Savings {fmtRs(c.savings)}</span>
            </div>
          </a>
        ))}
        {cards.length === 0 && <Card><div className="text-[13px] text-muted">No portfolios yet. Create one under Settings.</div></Card>}
      </div>
    </div>
  );
}
