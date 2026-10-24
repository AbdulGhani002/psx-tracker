// The month's buy list, looked back on: which shares came down to the price
// you wrote, which got away (never came down and rose 10% or more over the
// month while you waited), and which are still above your price. Kept
// honestly, it shows whether waiting for your price pays. Pure, so
// scripts/test-daily-brief.ts runs it.

export const AWAY_PCT = 10;

// `first` and `last`: the month's first and last closes (from the day the
// share was listed).
export type MissedItem = { symbol: string; top: number; minLow: number | null; first: number | null; last: number | null };
export type MissedReview = { came: Array<{ symbol: string; low: number; top: number }>; away: Array<{ symbol: string; risePct: number }>; above: string[] };

export function missedReview(items: MissedItem[]): MissedReview {
  const out: MissedReview = { came: [], away: [], above: [] };
  for (const i of items) {
    if (!(i.top > 0) || i.minLow == null || i.first == null || i.last == null || !(i.first > 0)) continue;
    if (i.minLow <= i.top) out.came.push({ symbol: i.symbol, low: i.minLow, top: i.top });
    else if (i.last >= i.first * (1 + AWAY_PCT / 100)) out.away.push({ symbol: i.symbol, risePct: (i.last / i.first - 1) * 100 });
    else out.above.push(i.symbol);
  }
  out.away.sort((a, b) => b.risePct - a.risePct);
  return out;
}

export function missedMessage(monthLabel: string, r: MissedReview): string | null {
  const total = r.came.length + r.away.length + r.above.length;
  if (total === 0) return null;
  const parts = [
    `${r.came.length} came to your price${r.came.length ? ` (${r.came.map((c) => c.symbol).join(", ")})` : ""}`,
    `${r.away.length} got away, up ${AWAY_PCT}%+${r.away.length ? ` (${r.away.map((a) => `${a.symbol} +${a.risePct.toFixed(0)}%`).join(", ")})` : ""}`,
    `${r.above.length} still above your price`,
  ];
  return `🧾 <b>Buy list, ${monthLabel}</b>: ${parts.join(" · ")}.`;
}
