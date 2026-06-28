import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getPatternScan, type ScannedPattern } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function Row({ p }: { p: ScannedPattern }) {
  const bull = p.direction === "bullish";
  const color = bull ? "var(--positive)" : "var(--negative)";
  return (
    <tr className="border-b border-rule hover:bg-[var(--paper-2)]">
      <td className="px-2 py-1.5"><Link href={`/stock/${p.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{p.symbol}</Link></td>
      <td className="px-2 py-1.5">{p.pattern}</td>
      <td className="px-2 py-1.5"><span className="font-mono text-[11px] uppercase" style={{ color }}>{bull ? "bullish" : "bearish"}</span></td>
      <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{Math.round(p.confidence * 100)}%</td>
      <td className="px-2 py-1.5">
        {p.triggered
          ? <span className="font-mono text-[10px] uppercase tracking-stat px-1.5 py-0.5" style={{ background: color, color: "var(--paper)" }}>triggered</span>
          : <span className="font-mono text-[10px] uppercase tracking-stat text-muted">forming</span>}
      </td>
      <td className="px-2 py-1.5 text-muted text-[12px]">{p.note}</td>
    </tr>
  );
}

function ScanTable({ rows }: { rows: ScannedPattern[] }) {
  if (!rows.length) return <p className="text-muted text-sm py-6">No clean setups right now.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-t border-ink border-b border-ink">
            {["Symbol", "Pattern", "Bias", "Confidence", "Status", "Detail"].map((h, i) => (
              <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 3 ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map((p, i) => <Row key={`${p.symbol}-${p.pattern}-${i}`} p={p} />)}</tbody>
      </table>
    </div>
  );
}

export default async function PatternsPage() {
  const data = await getPatternScan({ limit: 200 });
  if (!data || !data.results) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · Technicals" title="The pattern scanner is warming up." subtitle="Sweeping the whole market for chart setups." />
      </div>
    );
  }
  const all = data.results;
  const triggered = all.filter((p) => p.triggered);
  const bullish = all.filter((p) => p.direction === "bullish" && !p.triggered);
  const bearish = all.filter((p) => p.direction === "bearish" && !p.triggered);

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Technicals"
        title="Chart patterns across the whole PSX."
        subtitle="A nightly sweep for the classic reversal and continuation shapes — double tops and bottoms, head-and-shoulders, triangles — ranked by how clean each one is."
      />

      <Section number="01" title="Triggered" display={`${triggered.length} broken out`} description="The shape has completed — price has already broken the neckline. These are the most actionable, in either direction.">
        <ScanTable rows={triggered} />
      </Section>

      <Section number="02" title="Bullish, still forming" display={`${bullish.length} setups`} description="Bottoming or accumulation shapes that haven't broken out yet — a watchlist for the long side.">
        <ScanTable rows={bullish.slice(0, 40)} />
      </Section>

      <Section number="03" title="Bearish, still forming" display={`${bearish.length} setups`} description="Topping or distribution shapes that haven't broken down yet — caution for holders.">
        <ScanTable rows={bearish.slice(0, 40)} />
      </Section>

      <p className="text-[11px] text-muted mt-8 max-w-[64ch]">
        Patterns are detected from the daily closing-price swings, so they are a heuristic, not a guarantee — confirm with volume and the fundamentals before acting. Candlestick patterns (doji, engulfing, hammer) need intraday open-high-low-close data, which PSX's free feed doesn't publish, so they aren't included here.
      </p>
    </div>
  );
}
