// The Friday message for the model (lib/index-week): each index's week, how
// the week's range did, next week's levels and the record; and when it is
// due. Pure, so scripts/test-index-week.ts runs it.

import { isoWeek, type Levels, type RecordRow, type RecordSummary } from "./forecast";

export type IndexView = {
  code: string;
  label: string;
  date: string;
  close: number;
  weekChangePct: number | null; // since the last week's last close
  week: Levels | null;
  month: Levels | null;
  tested: { week: RecordSummary; weekLastYear: RecordSummary; month: RecordSummary };
  live: RecordSummary; // week-end levels published since this began
  weeks: RecordRow[]; // the last weeks, newest first
};
export type IndexForecasts = { asOf: string | null; computedAt: string; indexes: IndexView[] };

const pktDay = (now: number) => new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const dayLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Friday's message: each index's week, how last week's range did, next
// week's levels, and the record.
export function weekMessage(f: IndexForecasts, origin = ""): string | null {
  const k = f.indexes.find((i) => i.code === "KSE100");
  if (!k || !k.week) return null;
  const lines = [`📈 <b>Index week</b> · closes of ${dayLabel(k.date)}`];
  const ch = k.weekChangePct != null ? ` (${k.weekChangePct >= 0 ? "+" : ""}${k.weekChangePct.toFixed(1)}% on the week)` : "";
  lines.push(`<b>KSE-100 ${n0(k.close)}</b>${ch}`);
  const prev = k.weeks[0];
  if (prev) lines.push(`   Week to ${dayLabel(prev.outcome.date)}: range ${n0(prev.levels.range[0])}–${n0(prev.levels.range[1])}, closed ${n0(prev.outcome.close)}: ${prev.hits.range ? "inside ✓" : "outside ✗"}`);
  lines.push(`   Next week: likely ${n0(k.week.range[0])}–${n0(k.week.range[1])} · buy ${n0(k.week.buy[0])}–${n0(k.week.buy[1])} · sell ${n0(k.week.sell[0])}–${n0(k.week.sell[1])}`);
  for (const i of f.indexes) {
    if (i.code === "KSE100" || !i.week) continue;
    lines.push(`${i.label} ${n0(i.close)} · next week ${n0(i.week.range[0])}–${n0(i.week.range[1])}`);
  }
  const t = k.tested.week;
  lines.push(`Inside the range ${pct(t.range)} of ${t.n} weeks tested (aim 80%)${origin ? ` · ${origin}/analysis` : ""}`);
  return lines.join("\n");
}

// Whether this week's message is due: after the week's last close is in
// (Friday's, or on the weekend whatever the last one was).
export function weekMessageDue(f: IndexForecasts | null, now = Date.now()): string | null {
  if (!f?.asOf) return null;
  const today = pktDay(now);
  if (isoWeek(f.asOf) !== isoWeek(today)) return null;
  const asOfDay = new Date(f.asOf + "T00:00:00Z").getUTCDay();
  const todayDay = new Date(today + "T00:00:00Z").getUTCDay();
  return asOfDay === 5 || todayDay === 6 || todayDay === 0 ? `index-week:${isoWeek(f.asOf)}` : null;
}
