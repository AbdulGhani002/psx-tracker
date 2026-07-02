import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getRatings } from "@/lib/analytics";
import { RatingsBoard } from "./RatingsBoard";

export const dynamic = "force-dynamic";

// Server-render the top slice (instant paint, ~4× smaller HTML); RatingsBoard
// auto-loads the rest of the market when the user scrolls near the bottom.
const INITIAL_ROWS = 120;

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
        <RatingsBoard initial={rows.slice(0, INITIAL_ROWS)} sector={sel} total={rows.length} />
        <p className="text-[11px] text-muted mt-3 max-w-[80ch]">Risk is shown as a 0–100 score where higher means riskier (it lowers the overall via a safety term). P/B, ROE, ROA and Debt/Equity need a book value PSX doesn't publish — they're left out rather than guessed.</p>
      </Section>
    </div>
  );
}
