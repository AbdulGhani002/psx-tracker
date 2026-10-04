import { Card } from "@/components/ui/Card";
import type { FyBoard } from "@/lib/analytics/fy";
import { fmtRs, fmtSignedRs } from "@/lib/format";

// Profit by financial year (lib/analytics/fy-profit.ts), every year since the
// first trade, then where this year's came from, name by name.

const tone = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);

export function FyProfitTable({ board }: { board: FyBoard }) {
  if (board.years.length === 0) return null;
  const cur = board.current ?? board.years[0];
  const maxAbs = Math.max(1, ...cur.stocks.map((s) => Math.abs(s.profit)));
  const missing = [...new Set(board.years.flatMap((y) => y.missingPrices))];
  return (
    <Card className="mt-3" title="Profit by financial year" action={<span className="text-[12px] text-muted">July to June, dividends included</span>}>
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr>
              <th>Year</th>
              <th className="text-right">Worth at the start</th>
              <th className="text-right">Bought</th>
              <th className="text-right">Sold</th>
              <th className="text-right">Worth at the end</th>
              <th className="text-right">Price gain</th>
              <th className="text-right">Dividends</th>
              <th className="text-right">Profit</th>
              <th className="text-right">Return</th>
            </tr>
          </thead>
          <tbody>
            {board.years.map((y) => (
              <tr key={y.fy.label}>
                <td className="font-semibold whitespace-nowrap">
                  {y.fy.label}
                  {y.fy.current && <span className="text-[11px] font-normal text-muted"> to date</span>}
                </td>
                <td className="text-right mono-num">{fmtRs(y.startValue)}</td>
                <td className="text-right mono-num">{fmtRs(y.bought)}</td>
                <td className="text-right mono-num">{fmtRs(y.sold)}</td>
                <td className="text-right mono-num">{fmtRs(y.endValue)}</td>
                <td className="text-right mono-num" style={{ color: tone(y.capitalGain) }} title={`Realised on sales: ${fmtSignedRs(y.realized)}`}>{fmtSignedRs(y.capitalGain)}</td>
                <td className="text-right mono-num" title={y.dividendTax > 0 ? `After ${fmtRs(y.dividendTax)} tax withheld` : undefined}>{fmtRs(y.dividends)}</td>
                <td className="text-right mono-num font-semibold" style={{ color: tone(y.profit) }}>{fmtSignedRs(y.profit)}</td>
                <td className="text-right mono-num" style={{ color: y.returnPct == null ? undefined : tone(y.returnPct) }} title={y.returnShort ? "Too little of the year had money at work for a percentage to mean anything" : undefined}>{pct(y.returnPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cur.stocks.length > 0 && (
        <>
          <div className="label-cap mt-5 mb-2">Where {cur.fy.label}&apos;s profit came from</div>
          <div className="space-y-2">
            {cur.stocks.map((s) => (
              <div key={s.symbol} className="grid grid-cols-[70px_1fr_auto] items-center gap-3 text-[12.5px]">
                <span className="font-semibold">{s.symbol}</span>
                <div className="relative h-2 rounded-full" style={{ background: "var(--surface-2)" }}>
                  <div className="absolute top-0 h-full rounded-full" style={{ left: s.profit >= 0 ? "50%" : `${50 - (Math.abs(s.profit) / maxAbs) * 50}%`, width: `${(Math.abs(s.profit) / maxAbs) * 50}%`, background: tone(s.profit) }} />
                  <div className="absolute top-[-2px] left-1/2 w-px h-3" style={{ background: "var(--rule-strong)" }} />
                </div>
                <span className="mono-num text-right whitespace-nowrap" title={`Price gain ${fmtSignedRs(s.profit - s.dividends)} · dividends ${fmtRs(s.dividends)}`}>
                  <span style={{ color: tone(s.profit) }}>{fmtSignedRs(s.profit)}</span>
                  {s.dividends > 0 && <span className="text-muted text-[11px]"> incl. {fmtRs(s.dividends)} dividends</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[11.5px] text-muted mt-4 leading-relaxed">
        Profit is the worth at the end, less the worth at the start, less what was bought net of sales, plus the dividends paid. A dividend you reinvest counts once, the day it is paid: the shares it buys are a purchase like any other, and what they gain afterwards is price gain. Each year ends at the exchange&apos;s closing prices on the last trading day of June; the year not over, at today&apos;s. The return weighs each purchase and sale by the part of the year it was in.
        {missing.length > 0 && <> No year-end price for {missing.join(", ")}: taken as unchanged over that year.</>}
      </p>
    </Card>
  );
}
