import { Card } from "@/components/ui/Card";
import type { CashCalendar } from "@/lib/calculations/cash-calendar";
import { fmtRs } from "@/lib/format";

// The next 90 days of money in (lib/calculations/cash-calendar) and what the
// price rules' next adds would need.

const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function CashCalendarCard({ cal }: { cal: CashCalendar }) {
  return (
    <Card className="mt-3" title="Next 90 days" action={<span className="text-[12px] text-muted">Cash now {fmtRs(cal.cashNow)} · coming in {fmtRs(cal.in90)}</span>}>
      {cal.items.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nothing dated is due: no book closures known and no T-bill, sukuk or deposit paying in the next 90 days.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {cal.items.map((x, k) => (
                <tr key={k}>
                  <td className="whitespace-nowrap mono-num text-muted">{x.about ? "≈ " : ""}{day(x.date)}</td>
                  <td className="whitespace-nowrap">{x.label}{x.claim === "expected" && <span className="text-[11px] text-muted"> on the shares held now</span>}</td>
                  <td className="text-right mono-num">{fmtRs(x.pkr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12.5px] mt-3">
        In 30 days <span className="mono-num">{fmtRs(cal.in30)}</span> · 60 days <span className="mono-num">{fmtRs(cal.in60)}</span> · 90 days <span className="mono-num">{fmtRs(cal.in90)}</span>
      </p>
      {cal.needs.length > 0 && (
        <p className="text-[12.5px] mt-2">
          Your price rules&apos; next adds would need <span className="mono-num font-semibold">{fmtRs(cal.needsTotal)}</span>
          <span className="text-muted"> ({cal.needs.map((n) => `${n.symbol} ${n.qty.toLocaleString("en-US")} at ${n.price.toFixed(2)}`).join(", ")})</span>.{" "}
          {cal.shortBy > 0 ? <span style={{ color: "var(--negative)" }}>Short by {fmtRs(cal.shortBy)} even with all of it in.</span> : <span className="text-muted">Covered by cash now and what comes in.</span>}
        </p>
      )}
      <p className="text-[11.5px] text-muted mt-2">≈ Dividends land about three weeks after the book closure, in your bank. Deposits and T-bills count when they mature.</p>
    </Card>
  );
}
