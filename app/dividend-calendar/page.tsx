import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getDividendCalendar, type Dividend } from "@/lib/analytics";
import { getFaceValues } from "@/lib/data";

export const dynamic = "force-dynamic";

const TYPE_TONE: Record<string, string> = {
  cash: "var(--positive)",
  bonus: "var(--accent-deep)",
  right: "var(--amber)",
};

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] || m;
  return `${d} ${mon} ${y}`;
}

function daysUntil(iso: string, today: string) {
  const a = Date.parse(iso + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

function Types({ types }: { types: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {types.map((t) => (
        <span key={t} className="font-mono text-[10px] uppercase tracking-stat px-1.5 py-0.5 border" style={{ color: TYPE_TONE[t] || "var(--muted)", borderColor: "var(--rule)" }}>
          {t}
        </span>
      ))}
    </span>
  );
}

function Table({ rows, today, showCountdown, faces }: { rows: Dividend[]; today: string; showCountdown?: boolean; faces: Record<string, number> }) {
  if (!rows.length) return <p className="text-muted text-sm py-6">Nothing here yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-t border-ink border-b border-ink">
            {["Symbol", "Payout", "≈ Rs/sh", "Type", "Cycle", "Ex / book-closure", "Book closes", showCountdown ? "In" : "Announced"].map((h, i) => (
              <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 0 || i === 3 || i === 5 ? "left" : "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const d = showCountdown ? daysUntil(r.ex_date, today) : null;
            // Real par where we have it stored; Rs 10 PSX standard otherwise.
            const face = faces[r.symbol] ?? 10;
            const rs = r.pct_of_face == null ? null : (r.pct_of_face / 100) * face;
            return (
              <tr key={`${r.symbol}-${r.ex_date}-${idx}`} className="border-b border-rule hover:bg-[var(--paper-2)]">
                <td className="px-2 py-1.5"><Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link></td>
                <td className="px-2 py-1.5 text-right font-mono mono-num">{r.pct_of_face == null ? "—" : `${r.pct_of_face}%`}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num text-muted" title={face !== 10 ? `par Rs ${face}` : undefined}>
                  {rs == null ? "—" : rs.toFixed(2)}
                  {face !== 10 ? <span style={{ color: "var(--accent-deep)" }}>*</span> : null}
                </td>
                <td className="px-2 py-1.5"><Types types={r.types} /></td>
                <td className="px-2 py-1.5 text-right font-mono text-[11px] text-muted">{r.cycle || "—"}</td>
                <td className="px-2 py-1.5 font-mono mono-num">{fmtDay(r.ex_date)}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num text-muted">{fmtDay(r.book_closure_end)}</td>
                <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: d != null && d <= 5 ? "var(--accent-deep)" : "var(--muted)" }}>
                  {showCountdown ? (d == null ? "—" : d === 0 ? "today" : `${d}d`) : (r.announced || "—").split(" ").slice(0, 3).join(" ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function DividendCalendarPage() {
  const data = await getDividendCalendar();
  if (!data) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · Income" title="Dividend calendar is warming up." subtitle="Reading the latest PSX payout announcements." />
      </div>
    );
  }
  const { upcoming, recent, today } = data;
  const faces = await getFaceValues([...new Set([...upcoming, ...recent].map((r) => r.symbol))]);

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Income"
        title="Who's paying, and when."
        subtitle="Every announced PSX dividend, bonus and right issue — sorted by the book-closure date. To qualify you must hold the share before the book closure begins (the ex-date)."
      />

      <Section
        number="01"
        title="Upcoming"
        display={`${upcoming.length} ahead`}
        description="Book closure still to come. The ≈ Rs/share uses each company's real par value where we have it on file (marked * when it isn't Rs 10); everything else assumes the Rs 10 PSX standard. Cash (D), bonus (B) and right (R) are flagged separately."
      >
        <Table rows={upcoming} today={today} showCountdown faces={faces} />
      </Section>

      <Section number="02" title="Recently gone ex" description="Book closure has passed — these are the latest 30. Useful for spotting each company's payout cadence and history.">
        <Table rows={recent} today={today} faces={faces} />
      </Section>

      <p className="text-[11px] text-muted mt-8 max-w-[64ch]">
        Cash dividends on PSX are quoted as a percentage of face (par) value, not of the market price. A “15%” cash dividend on a Rs 10 par share is Rs 1.50 per share — but on a Rs 5 par share it is Rs 0.75, which is why rows marked * use the company&apos;s stored par instead of assuming Rs 10. Source: PSX payout announcements, refreshed daily.
      </p>
    </div>
  );
}
