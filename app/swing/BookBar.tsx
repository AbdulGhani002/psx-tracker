// One trade on a price line: the stop at the left, the target at the right,
// the entry between them and today's close as a dot. Red from the stop to the
// entry is what is risked, green from the entry to the target what is aimed
// for; the target sits twice as far from the entry as the stop, in percent.

import { money } from "@/app/analysis/ZoneBar";

export function BookBar({ stop, entry, target, now }: { stop: number; entry: number; target: number; now: number | null }) {
  const lo0 = Math.min(stop, entry, target, now ?? entry);
  const hi0 = Math.max(stop, entry, target, now ?? entry);
  const pad = (hi0 - lo0) * 0.04 || hi0 * 0.02;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const up = now != null && now >= entry;
  return (
    <div className="relative h-6" role="img" aria-label={`Stop ${money(stop)}, bought ${money(entry)}, target ${money(target)}${now != null ? `, now ${money(now)}` : ""}.`}>
      <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ background: "var(--rule-strong)" }} />
      <div className="absolute top-1 bottom-1 rounded-l-md" style={{ left: `${x(stop)}%`, width: `${x(entry) - x(stop)}%`, background: "color-mix(in srgb, var(--negative) 16%, transparent)" }} />
      <div className="absolute top-1 bottom-1 rounded-r-md" style={{ left: `${x(entry)}%`, width: `${x(target) - x(entry)}%`, background: "color-mix(in srgb, var(--positive) 16%, transparent)" }} />
      <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full" style={{ left: `${x(stop)}%`, background: "var(--negative)" }} />
      <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full" style={{ left: `${x(entry)}%`, background: "var(--ink)" }} />
      <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full" style={{ left: `${x(target)}%`, background: "var(--positive)" }} />
      {now != null && (
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full"
          style={{ left: `${x(now)}%`, background: up ? "var(--positive)" : "var(--negative)", border: "2px solid var(--surface)", boxShadow: `0 0 0 1px ${up ? "var(--positive)" : "var(--negative)"}` }}
        />
      )}
    </div>
  );
}
