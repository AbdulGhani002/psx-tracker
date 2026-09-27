// Corporate actions, read out of the exchange's own closing sheets.
//
// Every sheet carries LDCP, the previous close as the exchange adjusted it for
// that day's ex-date. Where LDCP differs from the raw previous close, the gap
// is the action: a cash dividend takes a round rupee amount off the price
// (FFC's Rs 10, 21, 7, 12, 9.5 ...), a bonus issue divides it by one plus a
// round percentage (10%, 25% ...), a split by a round ratio (MARI 2024, 1:10;
// LUCK 2025, 1:5). The 24-year archive therefore holds the dividend, bonus and
// split history of every name that ever traded, delisted ones included, with
// no scraping of anything else.
//
// The features built from it at a date use only actions whose ex-date is on or
// before that date: what an investor could have seen on the day.

import type { RawRow } from "./archive";

export type ActionKind = "cash" | "bonus" | "split" | "other";

export type CorporateAction = {
  date: string; // ex-date, ISO
  kind: ActionKind;
  prevClose: number; // raw close the day before
  ldcp: number; // the exchange's adjusted previous close
  factor: number; // ldcp / prevClose
  cash: number; // rupees per share, for cash dividends (0 otherwise)
  yieldPct: number; // cash / prevClose, in percent (0 for non-cash)
  ratioPct: number; // bonus or split: new shares per 100 held (e.g. 10, 900)
};

const iso = (n: number) => String(n).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
const near = (v: number, step: number, tol: number) => Math.abs(v - Math.round(v / step) * step) <= tol;

// Splits and bonuses divide the price by a round number; cash dividends take a
// round rupee amount off it. When both readings are round (a Rs 10 dividend on
// a Rs 110 share is also a "10% bonus") the smaller-looking reading wins: a
// cash dividend under a tenth of the price is far more common than a bonus.
export function classifyAction(prevClose: number, ldcp: number): { kind: ActionKind; cash: number; ratioPct: number } {
  const f = ldcp / prevClose;
  const cash = prevClose - ldcp;
  const ratioPct = (prevClose / ldcp - 1) * 100;
  if (f < 0.75) {
    const whole = Math.round(1 / f);
    const isSplit = whole >= 2 && Math.abs(1 / f - whole) / whole < 0.08;
    return { kind: isSplit ? "split" : "bonus", cash: 0, ratioPct };
  }
  if (f >= 1) return { kind: "other", cash: 0, ratioPct: 0 };
  const cashRound = near(cash, 0.05, 0.011);
  const bonusRound = near(ratioPct, 2.5, 0.06);
  if (cashRound && (!bonusRound || cash / prevClose < 0.1)) return { kind: "cash", cash, ratioPct: 0 };
  if (bonusRound) return { kind: "bonus", cash: 0, ratioPct };
  // A cash amount to the rupee but off the paisa grid: still a dividend.
  if (near(cash, 0.01, 0.0051) && cash / prevClose < 0.15) return { kind: "cash", cash, ratioPct: 0 };
  return { kind: "other", cash: 0, ratioPct: 0 };
}

export function extractActions(raw: RawRow[], threshold = 0.005): CorporateAction[] {
  const out: CorporateAction[] = [];
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1][4], ldcp = raw[i][6] ?? 0;
    if (!(prev > 0) || !(ldcp > 0)) continue;
    const f = ldcp / prev;
    if (Math.abs(f - 1) <= threshold || f < 0.005 || f > 200) continue;
    const c = classifyAction(prev, ldcp);
    out.push({
      date: iso(raw[i][0]),
      kind: c.kind,
      prevClose: prev,
      ldcp,
      factor: f,
      cash: c.cash,
      yieldPct: c.kind === "cash" ? (c.cash / prev) * 100 : 0,
      ratioPct: c.ratioPct,
    });
  }
  return out;
}

// ------------------------------------------------------------------ features

export const EVENT_FEATURE_NAMES = [
  "dy12", // cash dividends with an ex-date in the last 365 days, as a yield on the price each was paid at
  "divCount12", // how many of them
  "divGrowth", // last 12 months of dividend yield against the 12 months before
  "divYears5", // of the last five years, how many paid a cash dividend
  "daysSinceEx", // since the last cash ex-date, scaled to a year (1 = a year or never)
  "exSoon", // the name paid in the coming 45 days a year ago: the season is near
  "lastDivChange", // the last dividend against the one a year before it, as a yield difference
  "bonusRecent", // a bonus issue or split in the last 250 sessions (1) or not (0)
] as const;

const DAY = 86400000;
const clip = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v);

// The block at `date`, from actions sorted by date. Only actions on or before
// the date count, so the block can be built for any day of the history.
export function eventFeaturesAt(actions: Array<Pick<CorporateAction, "date" | "kind" | "yieldPct">>, date: string): number[] {
  const t = Date.parse(date);
  type A = Pick<CorporateAction, "date" | "kind" | "yieldPct">;
  let dy12 = 0, n12 = 0, dyPrev = 0, lastCash: A | null = null, lastBonus = -Infinity;
  const years = new Set<number>();
  const past: A[] = [];
  for (const a of actions) {
    if (a.date > date) break;
    past.push(a);
    const age = (t - Date.parse(a.date)) / DAY;
    if (a.kind === "cash") {
      if (age <= 365) { dy12 += a.yieldPct; n12++; }
      else if (age <= 730) dyPrev += a.yieldPct;
      if (age <= 5 * 365.25) years.add(Math.floor(age / 365.25));
      lastCash = a;
    } else if (a.kind === "bonus" || a.kind === "split") lastBonus = Math.max(lastBonus, Date.parse(a.date));
  }
  const daysSince = lastCash ? (t - Date.parse(lastCash.date)) / DAY : 365;
  // The same season a year ago: a cash ex-date between 320 and 365 days back
  // means the name paid in the next 45 days last year.
  const exSoon = past.some((a) => a.kind === "cash" && (t - Date.parse(a.date)) / DAY >= 320 && (t - Date.parse(a.date)) / DAY <= 365) ? 1 : 0;
  let lastDivChange = 0;
  if (lastCash) {
    const lt = Date.parse(lastCash.date);
    const yearAgo = past.filter((a) => a.kind === "cash" && a !== lastCash && Math.abs((lt - Date.parse(a.date)) / DAY - 365) <= 60);
    if (yearAgo.length) lastDivChange = lastCash.yieldPct - yearAgo[yearAgo.length - 1].yieldPct;
  }
  return [
    clip(dy12, 30) / 10,
    Math.min(n12, 6) / 4,
    clip(Math.log((dy12 + 0.5) / (dyPrev + 0.5)), 3) / 3,
    years.size / 5,
    Math.min(1, daysSince / 365),
    exSoon,
    clip(lastDivChange, 10) / 5,
    Number.isFinite(lastBonus) && (t - lastBonus) / DAY <= 365 ? 1 : 0,
  ];
}

// ------------------------------------------------------------- event study

// What the price did around each action, against a market index: the 20
// sessions before the ex-date (the run-up), and the 20 after (the drift). Log
// returns on the ADJUSTED series, so the ex-date's mechanical drop is not a
// loss. Null windows where the history does not reach.
export type EventReaction = CorporateAction & { before20: number | null; after20: number | null; after5: number | null };

export function eventReactions(
  actions: CorporateAction[],
  bars: Array<{ date: string; close: number }>,
  index: Array<{ date: string; close: number }>
): EventReaction[] {
  const pos = new Map(bars.map((b, i) => [b.date, i]));
  const idx = new Map(index.map((b) => [b.date, b.close]));
  const rel = (i0: number, i1: number): number | null => {
    if (i0 < 0 || i1 >= bars.length || i0 >= i1) return null;
    const a = bars[i0], b = bars[i1];
    const ia = idx.get(a.date), ib = idx.get(b.date);
    if (!ia || !ib) return null;
    return Math.log(b.close / a.close) - Math.log(ib / ia);
  };
  return actions.map((a) => {
    const i = pos.get(a.date);
    if (i == null) return { ...a, before20: null, after20: null, after5: null };
    return { ...a, before20: rel(i - 21, i - 1), after20: rel(i - 1, i + 19), after5: rel(i - 1, i + 4) };
  });
}
