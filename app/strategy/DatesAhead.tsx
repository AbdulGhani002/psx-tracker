import { Card } from "@/components/ui/Card";
import type { CalEvent } from "@/lib/calculations/market-calendar";

// The market's dates the app works out and catches itself
// (lib/market-calendar): nothing to type. Telegram tells you the evening
// before each one.

const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const from = (e: CalEvent) => (e.source === "rule" ? "rule" : e.source.startsWith("Mettis") ? "news" : "calendar");

export function DatesAhead({ events }: { events: CalEvent[] }) {
  return (
    <Card className="mt-3" title="Dates ahead" action={<span className="text-[12px] text-muted">Found by the app · Telegram the evening before</span>}>
      {events.length === 0 ? (
        <p className="text-[12.5px] text-muted">No dates in the next 90 days.</p>
      ) : (
        <ul className="text-[13px] divide-y divide-[var(--rule)]">
          {events.map((e, k) => (
            <li key={k} className="flex items-center gap-3 py-1.5">
              <span className="mono-num text-muted w-32 shrink-0">{e.about ? "≈ " : ""}{day(e.date)}</span>
              <span className="flex-1">{e.title}</span>
              <span className="text-[11px] text-muted" title={e.source}>{from(e)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] text-muted mt-2">Rule: futures expiry (last Friday), CPI (first working day), results deadlines, index reviews, T-bill auctions. News: MPC days caught from headlines. Calendar: holidays and dates only an announcement gives.</p>
    </Card>
  );
}
