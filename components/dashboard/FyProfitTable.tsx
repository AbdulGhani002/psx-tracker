import { Card } from "@/components/ui/Card";
import type { FyBoard, YearRow } from "@/lib/analytics/fy";
import { fmtRs, fmtSignedRs } from "@/lib/format";
import { TbillRatesForm } from "./TbillRatesForm";

// Profit by financial year (lib/analytics/fy.ts): the shares' price gain and
// dividends, the rest of the book, the CGT on the year's sales and what that
// leaves; then each year against the KSE-100, the KMI-30 and a T-bill.

const tone = (v: number) => (v >= 0 ? "var(--positive)" : "var(--negative)");
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
const otherOf = (y: YearRow) => y.other.funds + y.other.savings + y.other.fixed;
const afterTax = (y: YearRow) => y.total - (y.cgt ?? 0);
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function tbillTitle(y: YearRow): string | undefined {
  const m = y.market;
  const soFar = y.fy.current ? ", the part earned so far" : "";
  if (m.tbillFrom === "sbp") return `SBP's 12-month cut-off at the ${day(m.tbillAuction!)} auction: ${m.tbillRate}%${soFar}`;
  if (m.tbillFrom === "entered") return `${m.tbillRate}%, the rate you set${soFar}`;
  if (m.tbillFrom === "monthly") return `${m.tbillRate}%, from your July rates${soFar}`;
  if (m.tbillFrom === "policy") return "No T-bill rate for this year: money at the policy rate instead. Set the rate below.";
  return undefined;
}

function Money({ v, strong }: { v: number; strong?: boolean }) {
  return <td className={`text-right mono-num${strong ? " font-semibold" : ""}`} style={{ color: tone(v) }}>{fmtSignedRs(v)}</td>;
}

export function FyProfitTable({ board }: { board: FyBoard }) {
  if (board.years.length === 0) return null;
  const missing = [...new Set(board.years.flatMap((y) => y.missingPrices))];
  const hasOther = board.years.some((y) => Math.abs(otherOf(y)) >= 1);
  const sum = (f: (y: YearRow) => number) => board.years.reduce((s, y) => s + f(y), 0);
  return (
    <>
      <Card title="Profit by financial year" action={<span className="text-[12px] text-muted">July to June, dividends included</span>}>
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Year</th>
                <th className="text-right">Price gain</th>
                <th className="text-right">Dividends</th>
                {hasOther && <th className="text-right" title="Funds, savings, T-bills and deposits">Funds &amp; savings</th>}
                <th className="text-right">Profit</th>
                <th className="text-right" title="Capital gains tax on the year's sales, as on the Tax tab">CGT</th>
                <th className="text-right" title="Profit less the CGT. Dividends are already after the tax withheld.">After tax</th>
                <th className="text-right" title="The shares' profit on the money they had at work (Modified Dietz)">Return</th>
              </tr>
            </thead>
            <tbody>
              {board.years.map((y) => (
                <tr key={y.fy.label}>
                  <td className="font-semibold whitespace-nowrap" title={`Worth at the start ${fmtRs(y.startValue)} · bought ${fmtRs(y.bought)} · sold ${fmtRs(y.sold)} · worth at the end ${fmtRs(y.endValue)}`}>
                    {y.fy.label}
                    {y.fy.current && <span className="text-[11px] font-normal text-muted"> to date</span>}
                  </td>
                  <td className="text-right mono-num" style={{ color: tone(y.capitalGain) }} title={`Realised on sales: ${fmtSignedRs(y.realized)}`}>{fmtSignedRs(y.capitalGain)}</td>
                  <td className="text-right mono-num" title={y.dividendTax > 0 ? `After ${fmtRs(y.dividendTax)} tax withheld` : undefined}>{fmtRs(y.dividends)}</td>
                  {hasOther && (Math.abs(otherOf(y)) >= 1 ? <td className="text-right mono-num" style={{ color: tone(otherOf(y)) }} title={`Funds ${fmtSignedRs(y.other.funds)} · savings ${fmtSignedRs(y.other.savings)} · T-bills and deposits ${fmtSignedRs(y.other.fixed)}`}>{fmtSignedRs(otherOf(y))}</td> : <td className="text-right text-muted">–</td>)}
                  <Money v={y.total} strong />
                  <td className="text-right mono-num text-muted">{y.cgt != null ? fmtRs(y.cgt) : "–"}</td>
                  <Money v={afterTax(y)} />
                  <td className="text-right mono-num" style={{ color: y.returnPct == null ? undefined : tone(y.returnPct) }} title={y.returnShort ? "Too little of the year had money at work for a percentage to mean anything" : undefined}>{pct(y.returnPct)}</td>
                </tr>
              ))}
            </tbody>
            {board.years.length > 1 && (
              <tfoot>
                <tr className="font-semibold">
                  <td>All years</td>
                  <Money v={sum((y) => y.capitalGain)} />
                  <td className="text-right mono-num">{fmtRs(sum((y) => y.dividends))}</td>
                  {hasOther && <Money v={sum(otherOf)} />}
                  <Money v={sum((y) => y.total)} strong />
                  <td className="text-right mono-num text-muted">{fmtRs(sum((y) => y.cgt ?? 0))}</td>
                  <Money v={sum(afterTax)} />
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="text-[11.5px] text-muted mt-3">
          Profit = end − start − (bought − sold) + dividends{hasOther ? ", plus funds and savings" : ""}. Reinvested dividends count once.
          {missing.length > 0 && <> No year-end price for {missing.join(", ")}.</>}
        </p>
      </Card>

      <Card className="mt-3" title="Against the market" action={<span className="text-[12px] text-muted">Each year&apos;s change</span>}>
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Year</th>
                <th className="text-right">Your shares</th>
                <th className="text-right" title="Price only: the index leaves dividends out">KSE-100</th>
                <th className="text-right" title="Price only: the index leaves dividends out">KMI-30</th>
                <th className="text-right" title="A 12-month T-bill bought on 1 July, before tax">12M T-bill</th>
              </tr>
            </thead>
            <tbody>
              {board.years.map((y) => {
                const m = y.market;
                const beat = (v: number | null) => (y.returnPct != null && v != null ? (y.returnPct >= v ? "var(--positive)" : "var(--negative)") : undefined);
                return (
                  <tr key={y.fy.label}>
                    <td className="font-semibold whitespace-nowrap">{y.fy.label}{y.fy.current && <span className="text-[11px] font-normal text-muted"> to date</span>}</td>
                    <td className="text-right mono-num font-semibold">{pct(y.returnPct)}</td>
                    <td className="text-right mono-num" style={{ color: beat(m.kse) }}>{pct(m.kse)}</td>
                    <td className="text-right mono-num" style={{ color: beat(m.kmi) }}>{pct(m.kmi)}</td>
                    <td
                      className="text-right mono-num"
                      style={{ color: beat(m.tbill) }}
                      title={tbillTitle(y)}
                    >
                      {m.tbillFrom === "policy" && <span className="text-muted">≈ </span>}
                      {pct(m.tbill)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11.5px] text-muted mt-3">Green: your shares did better. The indexes leave dividends out. The T-bill is the 12-month cut-off at SBP&apos;s last auction before 1 July{board.years.some((y) => y.market.tbillFrom === "policy") ? "; ≈ is the policy rate where there is none" : ""}.</p>
        <details className="mt-2 text-[12.5px]">
          <summary className="cursor-pointer select-none text-muted">Set the 12-month T-bill rate for a year</summary>
          <TbillRatesForm years={board.years.map((y) => ({ endYear: y.fy.endYear, label: y.fy.label, rate: y.market.tbillEntered, inUse: y.market.tbillFrom === "policy" ? null : y.market.tbillRate }))} />
        </details>
      </Card>
    </>
  );
}
