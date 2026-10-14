import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { FyBoard } from "@/lib/analytics/fy";
import { fmtRs, fmtSignedRs } from "@/lib/format";

// Every share's profit or loss in each financial year (lib/analytics/fy-profit.ts):
// price, trades and dividends together, with the % on the capital the share
// had employed that year. Then all the years together, and the yield on cost:
// that total on the share's average capital employed over the days it was
// held (`employed`, from holding.ts moneyAtWork). Shares sold out stay in.

const tone = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");
const pct = (v: number | null) => (v == null ? null : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);

function Cell({ v, sub, strong }: { v: number | null; sub?: string | null; strong?: boolean }) {
  if (v == null) return <td className="text-right text-muted">–</td>;
  return (
    <td className={`text-right whitespace-nowrap${strong ? " font-semibold" : ""}`} style={{ color: tone(v) }}>
      <div className="mono-num">{fmtSignedRs(v)}</div>
      {sub && <div className="mono-num text-[11px] font-normal opacity-80">{sub}</div>}
    </td>
  );
}

export function YearlyShares({ board, employed }: { board: FyBoard; employed: Record<string, number> }) {
  if (board.years.length === 0) return null;
  const years = [...board.years].reverse();
  const now = board.current ?? board.years[0];
  const held = new Set(now.stocks.filter((s) => s.endShares > 0).map((s) => s.symbol));
  const rows = [...new Set(years.flatMap((y) => y.stocks.map((s) => s.symbol)))].map((symbol) => {
    const cells = years.map((y) => y.stocks.find((s) => s.symbol === symbol) ?? null);
    const total = cells.reduce((a, c) => a + (c?.profit ?? 0), 0);
    const base = employed[symbol] ?? 0;
    return { symbol, held: held.has(symbol), cells, total, base, yoc: base > 0 ? (total / base) * 100 : null };
  });
  rows.sort((a, b) => Number(b.held) - Number(a.held) || b.total - a.total);
  const grand = years.reduce((a, y) => a + y.profit, 0);

  return (
    <Card className="mt-3" title="Profit by share and year" action={<span className="text-[12px] text-muted">July to June, dividends included</span>}>
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr>
              <th>Share</th>
              {years.map((y) => (
                <th key={y.fy.label} className="text-right whitespace-nowrap">
                  {y.fy.label}
                  {y.fy.current && <span className="text-[11px] font-normal text-muted"> to date</span>}
                </th>
              ))}
              <th className="text-right whitespace-nowrap">All years</th>
              <th className="text-right whitespace-nowrap" title="All the years' profit on the capital employed in the share: what the shares held cost, averaged over the days held">Yield on cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="whitespace-nowrap">
                  <Link href={r.held ? `/holdings/${r.symbol}` : `/stock/${r.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{r.symbol}</Link>
                  {!r.held && <span className="text-[11px] text-muted"> sold</span>}
                </td>
                {r.cells.map((c, k) => (
                  <Cell key={years[k].fy.label} v={c ? c.profit : null} sub={c ? pct(c.returnPct) : null} />
                ))}
                <Cell v={r.total} strong />
                <td className="text-right whitespace-nowrap" title={r.base > 0 ? `${fmtSignedRs(r.total)} on ${fmtRs(r.base)} employed on average` : undefined}>
                  {r.yoc != null ? (
                    <div style={{ color: tone(r.yoc) }}>
                      <div className="mono-num">{pct(r.yoc)}</div>
                      <div className="mono-num text-[11px] opacity-80">on {fmtRs(r.base)}</div>
                    </div>
                  ) : (
                    <span className="text-muted">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="font-semibold">Total</td>
              {years.map((y) => (
                <Cell key={y.fy.label} v={y.profit} sub={pct(y.returnPct)} strong />
              ))}
              <Cell v={grand} strong />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11.5px] text-muted mt-4">
        A year&apos;s % is on the capital the share had employed in it; none when it was held only briefly or for a few rupees. Yield on cost is all the years on the capital employed while held.
      </p>
    </Card>
  );
}
