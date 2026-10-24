import { Card } from "@/components/ui/Card";
import type { Score } from "@/lib/calculations/scorecard";

// The trading scorecard: of the sales in each period, how many won, the
// average win and loss, the result a sale and the costs against the gains.

const pct = (v: number | null) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
const rs = (v: number | null) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}Rs ${Math.round(Math.abs(v)).toLocaleString("en-US")}`);

export function ScorecardCard({ rows }: { rows: Array<{ label: string; score: Score }> }) {
  if (!rows.some((r) => r.score.sales > 0)) return null;
  return (
    <Card className="mt-3" title="Scorecard" eyebrow="Your sales, matched to the oldest shares they used, after costs">
      <div className="overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr>
              <th>Period</th>
              <th className="text-right">Sales</th>
              <th className="text-right">Won</th>
              <th className="text-right">Average win</th>
              <th className="text-right">Average loss</th>
              <th className="text-right">A sale</th>
              <th className="text-right">Costs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, score: s }) => (
              <tr key={label}>
                <td className="whitespace-nowrap">{label}</td>
                <td className="text-right mono-num">{s.sales}</td>
                <td className="text-right mono-num">{s.winRate == null ? "–" : `${Math.round(s.winRate)}%`}</td>
                <td className="text-right mono-num" style={{ color: "var(--positive)" }}>{pct(s.avgWinPct)}</td>
                <td className="text-right mono-num" style={{ color: s.avgLossPct != null ? "var(--negative)" : undefined }}>{pct(s.avgLossPct)}</td>
                <td className="text-right mono-num">{rs(s.perSale)}</td>
                <td className="text-right mono-num whitespace-nowrap">Rs {Math.round(s.fees).toLocaleString("en-US")}{s.feesPctOfGains != null && <span className="text-[11px] text-muted"> {Math.round(s.feesPctOfGains)}% of gains</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-muted mt-2">Won: sales that made money after costs. Costs: brokerage and charges on the period&apos;s buys and sales.</p>
    </Card>
  );
}
