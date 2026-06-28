import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { Badge } from "@/components/ui/Badge";
import { getRatings, type RatedStock } from "@/lib/analytics";
import { fmtRs } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stars({ n }: { n: number }) {
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return (
    <span className="font-mono" style={{ color: "var(--accent)", letterSpacing: "1px" }} title={`${n}/5`}>
      {"★".repeat(full)}
      {half ? "⯨" : ""}
      <span style={{ color: "var(--rule)" }}>{"★".repeat(5 - full - (half ? 1 : 0))}</span>
    </span>
  );
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const color = value >= 70 ? "var(--positive)" : value >= 45 ? "var(--amber)" : "var(--negative)";
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${value}`}>
      <span className="font-mono mono-num text-[11px] w-5 text-right" style={{ color }}>{value}</span>
      <span className="inline-block h-1.5 w-10 rounded-sm overflow-hidden" style={{ background: "var(--rule)" }}>
        <span className="block h-full" style={{ width: `${value}%`, background: color }} />
      </span>
    </div>
  );
}

const verdictTone = (v: string): "positive" | "negative" | "default" => (v === "strong" || v === "good" ? "positive" : v === "weak" ? "negative" : "default");

export default async function RatingsPage({ searchParams }: { searchParams: { sector?: string } }) {
  const data = await getRatings(500);
  if (!data) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · AI" title="Stock ratings are warming up." subtitle="The analytics engine is computing scores across the market. Check back in a moment." />
      </div>
    );
  }
  let rows = data.results;
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort() as string[];
  const sel = searchParams.sector;
  if (sel) rows = rows.filter((r) => r.sector === sel);

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · AI"
        title="Every PSX stock, rated by AI."
        subtitle="A 0–100 score for every company, blended from a Fundamental, Technical and Risk sub-score (News is neutral until the news engine lands). Each is explained on the stock's page — no black box. Tuned for the Pakistani market."
      >
        <Link href="/screener" className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]">Open screener →</Link>
      </PageHeader>

      <Section number="01" title="AI rating board" display={`${rows.length} stocks${sel ? ` · ${sel}` : ""}, best first`} description="Click a symbol for the full breakdown. Use the screener to filter by any metric.">
        <div className="flex flex-wrap gap-1.5 mb-4">
          <Link href="/ratings" className="label-cap border px-2 py-1" style={{ borderColor: sel ? "var(--rule)" : "var(--ink)" }}>All</Link>
          {sectors.slice(0, 14).map((s) => (
            <Link key={s} href={`/ratings?sector=${encodeURIComponent(s)}`} className="label-cap border px-2 py-1" style={{ borderColor: sel === s ? "var(--ink)" : "var(--rule)" }}>{s.split(" ")[0]}</Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-t border-ink border-b border-ink">
                {["#", "Symbol", "Sector", "Price", "Day", "P/E", "Div%", "RSI", "Fund.", "Tech.", "Risk", "Rating", "Verdict"].map((h, i) => (
                  <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i >= 3 && i <= 7 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.symbol} className="border-b border-rule hover:bg-[var(--paper-2)]">
                  <td className="px-2 py-1.5 text-muted font-mono text-[11px]">{i + 1}</td>
                  <td className="px-2 py-1.5"><Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link></td>
                  <td className="px-2 py-1.5 text-muted text-[11px] truncate max-w-[160px]">{(r.sector || "").split(" ").slice(0, 2).join(" ")}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num">{r.price == null ? "—" : fmtRs(r.price, true)}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: (r.change_pct ?? 0) >= 0 ? "var(--positive)" : "var(--negative)" }}>{r.change_pct == null ? "—" : `${r.change_pct >= 0 ? "+" : ""}${r.change_pct.toFixed(1)}%`}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.pe == null ? "—" : `${r.pe.toFixed(1)}×`}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: "var(--positive)" }}>{r.dividend_yield_pct == null ? "—" : r.dividend_yield_pct.toFixed(1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{r.rsi14 == null ? "—" : Math.round(r.rsi14)}</td>
                  <td className="px-2 py-1.5"><ScoreBar value={r.score_fundamental} label="Fundamental" /></td>
                  <td className="px-2 py-1.5"><ScoreBar value={r.score_technical} label="Technical" /></td>
                  <td className="px-2 py-1.5"><ScoreBar value={r.score_risk} label="Risk" /></td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-display mono-num text-[18px]" style={{ fontVariationSettings: "'opsz' 144" }}>{r.overall}</span>
                      <Stars n={r.stars} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5"><Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted mt-3 max-w-[80ch]">Risk is shown as a 0–100 score where higher means riskier (it lowers the overall via a safety term). P/B, ROE, ROA and Debt/Equity need a book value PSX doesn't publish — they're left out rather than guessed.</p>
      </Section>
    </div>
  );
}
