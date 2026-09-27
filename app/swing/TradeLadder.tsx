// One swing trade on a price line: the stop, the buy level, the two profit
// levels and today's price. Red between the stop and the buy (what is risked),
// green from the buy to the second profit level (what is aimed for). Every
// position is a percentage of a range that holds all five, so it reads the
// same at any width; the numbers sit in a row underneath.

import type { SwingPlan } from "@/lib/quant/swing";
import { money } from "@/app/analysis/ZoneBar";

const pctFrom = (v: number, base: number) => `${v >= base ? "+" : ""}${(((v - base) / base) * 100).toFixed(1)}%`;

export function TradeLadder({ plan }: { plan: SwingPlan }) {
  const levels = [plan.stop, plan.entry, plan.t1, plan.t2, plan.price];
  const lo0 = Math.min(...levels), hi0 = Math.max(...levels);
  const pad = (hi0 - lo0) * 0.05 || hi0 * 0.02;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const tick = (v: number, color: string, label: string) => (
    <div className="absolute top-0 bottom-0 -translate-x-1/2 flex flex-col items-center" style={{ left: `${x(v)}%` }} title={`${label} ${money(v)}`}>
      <div className="w-[2px] h-full rounded-full" style={{ background: color }} />
    </div>
  );
  return (
    <div role="img" aria-label={`Buy ${money(plan.entry)}, stop ${money(plan.stop)}, targets ${money(plan.t1)} and ${money(plan.t2)}, price now ${money(plan.price)}.`}>
      <div className="relative h-7">
        <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ background: "var(--rule-strong)" }} />
        <div className="absolute top-1.5 bottom-1.5 rounded-l-md" style={{ left: `${x(plan.stop)}%`, width: `${x(plan.entry) - x(plan.stop)}%`, background: "color-mix(in srgb, var(--negative) 16%, transparent)" }} />
        <div className="absolute top-1.5 bottom-1.5 rounded-r-md" style={{ left: `${x(plan.entry)}%`, width: `${x(plan.t2) - x(plan.entry)}%`, background: "color-mix(in srgb, var(--positive) 16%, transparent)" }} />
        {tick(plan.stop, "var(--negative)", "Stop")}
        {tick(plan.entry, "var(--positive)", "Buy")}
        {tick(plan.t1, "var(--blue)", "T1")}
        {tick(plan.t2, "var(--blue)", "T2")}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full" style={{ left: `${x(plan.price)}%`, background: "var(--ink)", border: "2px solid var(--surface)", boxShadow: "0 0 0 1px var(--ink)" }} />
      </div>
      <div className="grid grid-cols-4 gap-2 mt-2 text-[12px]">
        <div>
          <div className="text-muted text-[11px]">{plan.entryNow ? "Buy now" : "Buy at"}</div>
          <div className="font-semibold mono-num" style={{ color: "var(--positive)" }}>{money(plan.entry)}</div>
        </div>
        <div>
          <div className="text-muted text-[11px]">Stop</div>
          <div className="font-semibold mono-num" style={{ color: "var(--negative)" }}>{money(plan.stop)} <span className="font-normal text-muted">{pctFrom(plan.stop, plan.entry)}</span></div>
        </div>
        <div>
          <div className="text-muted text-[11px]">Target 1</div>
          <div className="font-semibold mono-num" style={{ color: "var(--blue)" }}>{money(plan.t1)} <span className="font-normal text-muted">{pctFrom(plan.t1, plan.entry)}</span></div>
        </div>
        <div>
          <div className="text-muted text-[11px]">Target 2</div>
          <div className="font-semibold mono-num" style={{ color: "var(--blue)" }}>{money(plan.t2)} <span className="font-normal text-muted">{pctFrom(plan.t2, plan.entry)}</span></div>
        </div>
      </div>
    </div>
  );
}
