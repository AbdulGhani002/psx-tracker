// A sell list's levels against the exchange's closing files
// (lib/models/SellList): which level a share has reached and when, how far
// the rest are, and what Telegram says. Pure, so scripts/test-sell-list.ts
// runs it.
//   A take-profit level is reached on the first day, from the day it was
//   set, whose high gets to it; a stop on the first close at or under it.
//   Once reached it stays reached (Telegram says it once) until a close 5%
//   back the other way arms it again.

export type LevelKind = "profit" | "stop";
export type Level = { price: number; kind: LevelKind; sellPct: number | null; note: string; armedAt: string; reachedAt: string; reachedPrice: number | null; reachedClose: number | null };
export type Day = { date: string; high: number; close: number };
export type Reach = { level: number; date: string; price: number; close: number };

export const REARM = 0.05;

export function advance(levels: Level[], days: Day[]): { levels: Level[]; reached: Reach[] } {
  const next = levels.map((l) => ({ ...l }));
  const reached: Reach[] = [];
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!(d.close > 0)) continue;
    const high = d.high > 0 ? Math.max(d.high, d.close) : d.close;
    next.forEach((l, k) => {
      if (l.armedAt && d.date < l.armedAt) return;
      if (!l.reachedAt) {
        const hit = l.kind === "profit" ? high >= l.price : d.close <= l.price;
        if (hit) {
          l.reachedAt = d.date;
          l.reachedPrice = l.kind === "profit" ? high : d.close;
          l.reachedClose = d.close;
          reached.push({ level: k, date: d.date, price: l.reachedPrice, close: d.close });
        }
      } else if (d.date > l.reachedAt && (l.kind === "profit" ? d.close < l.price * (1 - REARM) : d.close > l.price * (1 + REARM))) {
        l.reachedAt = "";
        l.reachedPrice = null;
        l.reachedClose = null;
        l.armedAt = d.date;
      }
    });
  }
  return { levels: next, reached };
}

// Up to six levels, the highest price first: profit levels above, stops below.
export function cleanLevels(raw: Array<{ price: number; kind?: string; sellPct?: number | null; note?: string }>, today: string): Level[] {
  return raw
    .filter((l) => Number.isFinite(l.price) && l.price > 0)
    .map((l) => ({
      price: l.price,
      kind: (l.kind === "stop" ? "stop" : "profit") as LevelKind,
      sellPct: l.sellPct != null && Number.isFinite(l.sellPct) && l.sellPct > 0 ? Math.min(100, l.sellPct) : null,
      note: (l.note ?? "").trim().slice(0, 120),
      armedAt: today,
      reachedAt: "",
      reachedPrice: null,
      reachedClose: null,
    }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 6);
}

// How far the price has to move to a level, %: up for a profit level, down
// (negative) for a stop. 0 or past it means it is there.
export const toGoPct = (price: number | null, l: { price: number }) => (price != null && price > 0 ? Math.round((l.price / price - 1) * 1000) / 10 : null);

// The shares a level sells out of those held: its % of them, at least one.
export const sharesToSell = (held: number, pct: number | null) => (pct == null || held <= 0 ? null : Math.min(held, Math.max(1, Math.floor((held * pct) / 100))));

export const money = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dayLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

export function reachMessage(symbol: string, l: Level, r: { date: string; price: number; close: number }, held: { shares: number; avgCost: number } | null): string {
  const head =
    l.kind === "profit"
      ? `💰 <b>${esc(symbol)}</b> reached your sell price ${money(l.price)}: high ${money(r.price)}, close ${money(r.close)} on ${dayLabel(r.date)}.`
      : `🛑 <b>${esc(symbol)}</b> closed at ${money(r.close)}, at or under your stop ${money(l.price)}, on ${dayLabel(r.date)}.`;
  const lines = [head];
  const n = held ? sharesToSell(held.shares, l.sellPct) : null;
  const parts: string[] = [];
  if (n != null && l.sellPct != null) parts.push(`Sell ${l.sellPct}% = ${n.toLocaleString("en-US")} shares (≈ Rs ${Math.round(n * r.close).toLocaleString("en-US")})`);
  if (held && held.avgCost > 0) parts.push(`${signed((r.close / held.avgCost - 1) * 100)} on your ${money(held.avgCost)}`);
  if (parts.length) lines.push(`   ${parts.join(". ")}.`);
  if (l.note) lines.push(`   ${esc(l.note)}`);
  return lines.join("\n");
}
