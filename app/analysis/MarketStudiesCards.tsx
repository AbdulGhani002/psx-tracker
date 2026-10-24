import { Card } from "@/components/ui/Card";
import type { MarketStudies } from "@/lib/market-history";

// The KSE-100 by calendar month and by the State Bank's rate cycle
// (lib/market-history), with what each result can and cannot say.

const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const mon = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const tone = (v: number | null | undefined) => (v == null ? undefined : v >= 0 ? "var(--positive)" : "var(--negative)");

export function MarketStudiesCards({ s }: { s: MarketStudies }) {
  const h = s.history;
  const thisMonth = Number(new Date(Date.now() + 5 * 3600_000).toISOString().slice(5, 7));
  const span = h.from && h.to ? `${mon(h.from)} to ${mon(h.to)}` : "";
  const c = s.cycles;
  return (
    <>
      <Card title="Month by month" action={<span className="text-[12px] text-muted">KSE-100 with dividends · {span}</span>}>
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Rose</th>
                <th className="text-right">Median</th>
                <th className="text-right">Average</th>
                <th className="text-right">Best</th>
                <th className="text-right">Worst</th>
              </tr>
            </thead>
            <tbody>
              {s.patterns.months.map((m) => (
                <tr key={m.m} className={m.m === thisMonth ? "font-semibold" : ""}>
                  <td>{m.label}{m.m === thisMonth && <span className="text-[11px] text-muted font-normal"> this month</span>}</td>
                  <td className="text-right mono-num">{m.up} of {m.n}</td>
                  <td className="text-right mono-num" style={{ color: tone(m.median) }}>{pct(m.median)}</td>
                  <td className="text-right mono-num">{pct(m.mean)}</td>
                  <td className="text-right mono-num text-muted whitespace-nowrap">{pct(m.best.ret, 0)} <span className="text-[11px]">{m.best.month.slice(0, 4)}</span></td>
                  <td className="text-right mono-num text-muted whitespace-nowrap">{pct(m.worst.ret, 0)} <span className="text-[11px]">{m.worst.month.slice(0, 4)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted mt-2">The average month: {pct(s.patterns.mean, 2)}.</p>
      </Card>

      <Card
        title="Rate cycles"
        action={
          <span className="text-[12px] text-muted">
            Now {s.now.state ?? "–"}
            {s.now.since ? ` since ${day(s.now.since)}` : ""}
            {s.now.rate != null ? ` · policy ${s.now.rate}%` : ""}
          </span>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
          <div>
            <div className="text-[12px] text-muted">After a cut (easing)</div>
            <div className="mono-num"><span className="font-semibold" style={{ color: tone(c.easing.mean) }}>{pct(c.easing.mean, 2)}</span> a month · rose in {c.easing.up} of {c.easing.n}</div>
          </div>
          <div>
            <div className="text-[12px] text-muted">After a rise (tightening)</div>
            <div className="mono-num"><span className="font-semibold" style={{ color: tone(c.tightening.mean) }}>{pct(c.tightening.mean, 2)}</span> a month · rose in {c.tightening.up} of {c.tightening.n}</div>
          </div>
        </div>
        <div className="overflow-x-auto -mx-2 mt-3">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Cycle began</th>
                <th>Move</th>
                <th className="text-right">3 months on</th>
                <th className="text-right">12 months on</th>
              </tr>
            </thead>
            <tbody>
              {s.after.map((a) => (
                <tr key={a.turn.date}>
                  <td className="whitespace-nowrap">{h.rebuiltTo && a.turn.date.slice(0, 7) <= h.rebuiltTo ? <span className="text-muted" title="From the rebuilt index">≈ </span> : null}{day(a.turn.date)}</td>
                  <td className="whitespace-nowrap">{a.turn.kind === "cut" ? "First cut" : "First rise"} <span className="text-muted text-[12px]">{a.turn.before}% → {a.turn.after}%</span></td>
                  <td className="text-right mono-num" style={{ color: tone(a.m3) }}>{pct(a.m3)}</td>
                  <td className="text-right mono-num" style={{ color: tone(a.m12 ?? a.soFar) }}>{a.m12 != null ? pct(a.m12) : a.soFar != null ? <span>{pct(a.soFar)} <span className="text-[11px] text-muted">so far</span></span> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted mt-2">From the month-end before the new rate took effect. A month counts as easing when the last change before it began was a cut. ≈ rows come from the rebuilt index: today&apos;s members, so a single cycle can be several points off; the averages hold up better.</p>
      </Card>

      <details className="text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">What these can and cannot say</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>Each month has only {s.patterns.months[0]?.n ?? 0} results; one crash or boom moves its average. Tested twelve at a time, no month stands out reliably.</li>
          <li>There are few rate cycles, they come in long blocks, and the market often moves before the State Bank does. A tendency, not a rule.</li>
          <li>
            {h.rebuiltTo ? `To ${mon(h.rebuiltTo)} the index is rebuilt from its ${h.members} current members (free-float shares × prices adjusted for bonus and splits, dividends added back), so companies that have since left are missing. ` : ""}
            {h.fit.corr != null ? `On the ${h.fit.months} months both have, the rebuilt and the real index agree at r = ${h.fit.corr.toFixed(2)}, ${h.fit.meanAbsDiff?.toFixed(1)} points apart on average.` : ""}
          </li>
          <li>Rate steps: the State Bank&apos;s history back to 1991, then the app&apos;s own rate feed.</li>
        </ul>
      </details>
    </>
  );
}
