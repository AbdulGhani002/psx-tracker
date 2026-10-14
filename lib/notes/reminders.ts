// Trade notes shown back: the reason typed on a buy or a sale, three months
// and a year later, with what the price has done since. Pure, so
// scripts/test-trade-notes.ts runs it.

export type NoteTrade = { id: string; symbol: string; type: "BUY" | "SELL"; date: string; price: number; note: string };

// Notes the app wrote itself are not reasons.
export const isReason = (note: string) => {
  const n = note.trim();
  return n.length >= 3 && !/^imported\b/i.test(n) && !/figures typed in/i.test(n) && !/^auto\b/i.test(n);
};

export function addMonths(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// The notes due today: three months or a year on, within two weeks of the
// day, so a note found late still comes once and old ones never flood.
export function dueNotes(trades: NoteTrade[], today: string, windowDays = 14): Array<{ trade: NoteTrade; months: 3 | 12; due: string }> {
  const out: Array<{ trade: NoteTrade; months: 3 | 12; due: string }> = [];
  const end = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + windowDays * 86400000).toISOString().slice(0, 10);
  for (const t of trades) {
    if (!isReason(t.note)) continue;
    for (const months of [3, 12] as const) {
      const due = addMonths(t.date, months);
      if (today >= due && today <= end(due)) out.push({ trade: t, months, due });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));

// `changePct` is the price since the trade, bonus and split adjusted.
export function noteMessage(t: NoteTrade, months: 3 | 12, now: { price: number; changePct: number } | null): string {
  const when = months === 12 ? "A year ago" : "3 months ago";
  const lines = [`📝 ${when} you ${t.type === "BUY" ? "bought" : "sold"} <b>${esc(t.symbol)}</b> at ${money(t.price)}: “${esc(t.note.trim().slice(0, 300))}”`];
  if (now) {
    const up = now.changePct >= 0;
    const verdict = t.type === "BUY" ? (up ? "the buy is ahead" : "the buy is behind") : up ? "it has risen since you sold" : "selling was right so far";
    lines.push(`   Now ${money(now.price)}, ${up ? "+" : "−"}${Math.abs(now.changePct).toFixed(1)}%: ${verdict}.`);
  }
  return lines.join("\n");
}
