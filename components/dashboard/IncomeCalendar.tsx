import { Card } from "@/components/ui/Card";
import type { IncomeCalendar as Calendar, IncomeCell } from "@/lib/calculations/income-calendar";
import { fmtRs } from "@/lib/format";

// The financial year's income month by month, after tax
// (lib/calculations/income-calendar.ts): green came in, grey is expected.

const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));

function Cell({ c, bold }: { c: IncomeCell; bold?: boolean }) {
  const v = c.received + c.expected;
  if (!(v >= 1)) return <td className="text-center mono-num text-[12px]" style={{ color: "var(--faint)" }}>–</td>;
  const title = [c.received >= 1 ? `${fmtRs(c.received)} received` : "", c.expected >= 1 ? `${fmtRs(c.expected)} expected` : ""].filter(Boolean).join(", ");
  return (
    <td className={`text-center mono-num text-[12px]${bold ? " font-semibold" : ""}`} style={{ color: c.received >= c.expected ? "var(--positive)" : "var(--muted)" }} title={title}>
      {short(v)}
    </td>
  );
}

export function IncomeCalendar({ cal }: { cal: Calendar }) {
  if (cal.received + cal.expected < 1) return null;
  const rows: Array<[string, (m: Calendar["months"][number]) => IncomeCell]> = [["Dividends", (m) => m.dividends]];
  if (cal.hasFixed) rows.push(["T-bills, sukuks & FDs", (m) => m.fixed]);
  if (cal.hasCash) rows.push(["Savings & funds", (m) => m.cash]);
  return (
    <Card className="mt-3" title={`Income by month, ${cal.fyLabel}`} action={<span className="text-[12px] text-muted">After tax</span>}>
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr><th></th>{cal.months.map((m) => <th key={m.key} className="text-center">{m.label}</th>)}<th className="text-right">Year</th></tr>
          </thead>
          <tbody>
            {rows.map(([label, pick]) => (
              <tr key={label}>
                <td className="whitespace-nowrap">{label}</td>
                {cal.months.map((m) => <Cell key={m.key} c={pick(m)} />)}
                <td className="text-right mono-num text-[12px]">{fmtRs(cal.months.reduce((s, m) => s + pick(m).received + pick(m).expected, 0))}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr>
                <td className="font-semibold">Total</td>
                {cal.months.map((m) => <Cell key={m.key} c={{ received: m.received, expected: m.expected }} bold />)}
                <td className="text-right mono-num text-[12px] font-semibold">{fmtRs(cal.received + cal.expected)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted mt-3">
        <span style={{ color: "var(--positive)" }}>{fmtRs(cal.received)} received</span> · {fmtRs(cal.expected)} expected
      </p>
    </Card>
  );
}
