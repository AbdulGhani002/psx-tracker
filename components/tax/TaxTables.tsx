import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { TaxYearRow, FbrPack } from "@/lib/data";
import { fmtRs, fmtDate } from "@/lib/format";

// The Tax tab's tables: every year in brief, and a year's T-bill and sukuk
// profit with the tax withheld on it.

export function TaxByYear({ years, selected }: { years: TaxYearRow[]; selected: number }) {
  if (years.length === 0) return null;
  return (
    <Card className="mb-3" title="Tax by year" action={<span className="text-[12px] text-muted">This year: so far</span>}>
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr><th>Year</th><th className="text-right">Shares (CGT)</th><th className="text-right">Dividends</th><th className="text-right">T-bills &amp; sukuks</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.endYear} style={y.endYear === selected ? { background: "var(--surface-2)" } : undefined}>
                <td className="whitespace-nowrap"><Link href={`/portfolio?tab=cgt&fy=${y.endYear}`} className="font-semibold hover:text-[var(--accent-deep)]">{y.label}</Link>{y.current && <span className="text-[11px] text-muted"> so far</span>}</td>
                <td className="text-right mono-num">{fmtRs(y.cgt)}</td>
                <td className="text-right mono-num">{fmtRs(y.dividendTax)}</td>
                <td className="text-right mono-num">{fmtRs(y.fixedTax)}</td>
                <td className="text-right mono-num font-semibold">{fmtRs(y.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function FixedIncomeTax({ rows }: { rows: FbrPack["fixed"]["rows"] }) {
  if (rows.length === 0) return null;
  return (
    <Card className="mt-3" title="T-bills and sukuks" action={<span className="text-[12px] text-muted">Tax withheld by the bank</span>}>
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr><th>Name</th><th>Date</th><th>Paid as</th><th className="text-right">Profit</th><th className="text-right">Tax</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={r.paid ? undefined : { opacity: 0.55 }}>
                <td className="font-semibold">{r.name}</td>
                <td className="mono-num text-muted whitespace-nowrap">{fmtDate(r.date)}{!r.paid && " · to come"}</td>
                <td>{r.what === "coupon" ? "Profit payment" : "At maturity"}</td>
                <td className="text-right mono-num">{fmtRs(r.gross)}</td>
                <td className="text-right mono-num">{fmtRs(r.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
