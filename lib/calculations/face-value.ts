// A company's face value, read from what the exchange did: on a cash
// dividend's ex-date the closing file takes the dividend off the price
// (ShareEvent cash, rupees a share then), and the payout gives it as a % of
// the face value, so the face value is the cash over the %. Only the usual
// face values count, so a day that also had a bonus or a split (a bigger
// drop) proves nothing. Pure, so scripts/test-face-value.ts runs it.

export const FACES = [1, 2, 2.5, 5, 10, 100];

export function snapFace(v: number, tol = 0.03): number | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  return FACES.find((f) => Math.abs(v / f - 1) <= tol) ?? null;
}

export type FacePayout = { bookClosure: string | null; pctOfFace: number; payoutType: string };
export type FaceEvent = { date: string; cash: number };

const DAY = 86400000;
const back = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") - days * DAY).toISOString().slice(0, 10);

// The cash dividend gone ex for a payout: the latest in the ten days before
// its book closure (the ex-date is a trading day or two before it).
export function eventFor(p: FacePayout, events: FaceEvent[]): FaceEvent | null {
  if (!p.bookClosure) return null;
  const from = back(p.bookClosure, 10);
  let best: FaceEvent | null = null;
  for (const e of events) if (e.cash > 0 && e.date >= from && e.date <= p.bookClosure && (!best || e.date > best.date)) best = e;
  return best;
}

export function faceOf(p: FacePayout, events: FaceEvent[]): { face: number; event: FaceEvent } | null {
  if (p.payoutType !== "cash" || !(p.pctOfFace > 0)) return null;
  const e = eventFor(p, events);
  const face = e ? snapFace(e.cash / (p.pctOfFace / 100)) : null;
  return e && face != null ? { face, event: e } : null;
}

// The face value now: from the newest cash payout its ex-date shows. A split
// since then shows at the next dividend.
export function currentFace(payouts: FacePayout[], events: FaceEvent[], today: string): { face: number; bookClosure: string; cash: number; pct: number } | null {
  const past = payouts.filter((p) => p.bookClosure && p.bookClosure <= today).sort((a, b) => b.bookClosure!.localeCompare(a.bookClosure!));
  for (const p of past) {
    const m = faceOf(p, events);
    if (m) return { face: m.face, bookClosure: p.bookClosure!, cash: m.event.cash, pct: p.pctOfFace };
  }
  return null;
}
