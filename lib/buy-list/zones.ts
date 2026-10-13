// A buy list's tiers against the exchange's closing files (lib/models/BuyList):
// which tier a share has reached and when, how far the rest are, and what
// Telegram says. Pure, so scripts/test-buy-list.ts runs it.
//   A tier is reached on the first day, from the day it was set, whose low
//   got to its top price. Once reached it stays reached (Telegram says it
//   once) until a close 5% above its top arms it again.

export type Tier = { high: number; low: number | null; note: string; armedAt: string; reachedAt: string; reachedLow: number | null; reachedClose: number | null };
export type Day = { date: string; low: number; close: number };
export type Reach = { tier: number; date: string; low: number; close: number };

export const REARM = 1.05;

export function advance(tiers: Tier[], days: Day[]): { tiers: Tier[]; reached: Reach[] } {
  const next = tiers.map((t) => ({ ...t }));
  const reached: Reach[] = [];
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!(d.low > 0) || !(d.close > 0)) continue;
    next.forEach((t, k) => {
      if (t.armedAt && d.date < t.armedAt) return;
      if (!t.reachedAt) {
        if (d.low <= t.high) {
          t.reachedAt = d.date;
          t.reachedLow = d.low;
          t.reachedClose = d.close;
          reached.push({ tier: k, date: d.date, low: d.low, close: d.close });
        }
      } else if (d.date > t.reachedAt && d.close > t.high * REARM) {
        t.reachedAt = "";
        t.reachedLow = null;
        t.reachedClose = null;
        t.armedAt = d.date;
      }
    });
  }
  return { tiers: next, reached };
}

// Tiers from the highest down, each top above its floor.
export function cleanTiers(raw: Array<{ high: number; low?: number | null; note?: string }>, today: string): Tier[] {
  return raw
    .filter((t) => Number.isFinite(t.high) && t.high > 0)
    .map((t) => {
      const low = t.low != null && Number.isFinite(t.low) && t.low > 0 && t.low < t.high ? t.low : null;
      return { high: t.high, low, note: (t.note ?? "").trim().slice(0, 120), armedAt: today, reachedAt: "", reachedLow: null, reachedClose: null };
    })
    .sort((a, b) => b.high - a.high)
    .slice(0, 6);
}

export type TierState = "reached" | "waiting";

// How far the price has to fall to a tier's top, %; 0 or under means it is there.
export const awayPct = (price: number | null, t: { high: number }) => (price != null && price > 0 ? Math.round((price / t.high - 1) * 1000) / 10 : null);

export const money = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
export const zoneText = (t: { high: number; low: number | null }) => (t.low != null ? `${money(t.low)}–${money(t.high)}` : `≤ ${money(t.high)}`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dayLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function reachMessage(symbol: string, tiers: Tier[], k: number, r: { date: string; low: number; close: number }): string {
  const t = tiers[k];
  const next = tiers[k + 1];
  const lines = [`🎯 <b>${esc(symbol)}</b> reached buy tier ${k + 1} of ${tiers.length} (${zoneText(t)}): low ${money(r.low)}, close ${money(r.close)} on ${dayLabel(r.date)}.`];
  if (t.note) lines.push(`   ${esc(t.note)}`);
  if (next) lines.push(`   Next: tier ${k + 2} at ${zoneText(next)}.`);
  return lines.join("\n");
}
