import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Section } from "@/components/layout/Section";
import { getEarningsCalendar, type EarningsRow } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function fmtDay(iso: string) {
  const [y, m, d] = iso.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] || m;
  return `${d} ${mon} ${y}`;
}

function daysUntil(iso: string, today: string) {
  const a = Date.parse(iso + "T00:00:00Z"), b = Date.parse(today + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 86400000) : null;
}

function Table({ rows, today, countdown }: { rows: EarningsRow[]; today: string; countdown?: boolean }) {
  if (!rows.length) return <p className="text-muted text-sm py-6">Nothing scheduled right now — new board-meeting notices land with the nightly refresh.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-t border-ink border-b border-ink">
            {["Symbol", "Date", countdown ? "In" : "", "Purpose"].filter(Boolean).map((h, i) => (
              <th key={h} className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium" style={{ textAlign: i === 2 && countdown ? "right" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = countdown ? daysUntil(r.date, today) : null;
            return (
              <tr key={`${r.symbol}-${r.date}-${i}`} className="border-b border-rule hover:bg-[var(--paper-2)]">
                <td className="px-2 py-1.5"><Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">{r.symbol}</Link></td>
                <td className="px-2 py-1.5 font-mono mono-num">{fmtDay(r.date)}</td>
                {countdown && (
                  <td className="px-2 py-1.5 text-right font-mono mono-num" style={{ color: d != null && d <= 3 ? "var(--accent-deep)" : "var(--muted)" }}>
                    {d == null ? "—" : d === 0 ? "today" : `${d}d`}
                  </td>
                )}
                <td className="px-2 py-1.5 text-muted text-[12px] max-w-[520px]">{(r.purpose || "Board meeting").slice(0, 120)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function EarningsCalendarPage() {
  const data = await getEarningsCalendar();
  if (!data) {
    return (
      <div className="fade-in">
        <PageHeader eyebrow="Market · Calendar" title="The earnings calendar is warming up." subtitle="Reading the latest board-meeting notices." />
      </div>
    );
  }
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Market · Calendar"
        title="Who reports next."
        subtitle="Board-meeting notices from PSX company announcements — the dates results, dividends and corporate actions get decided. Collected for every listed company, refreshed nightly."
      />
      <Section number="01" title="Upcoming" display={`${data.upcoming.length} scheduled`} description="Board meetings still to come. Results usually move the price — the closed period before the meeting is also when insiders can't trade.">
        <Table rows={data.upcoming} today={data.today} countdown />
      </Section>
      <Section number="02" title="Recent" description="The last 60 board-meeting announcements, newest first.">
        <Table rows={data.recent} today={data.today} />
      </Section>
    </div>
  );
}
