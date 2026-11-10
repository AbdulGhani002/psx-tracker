// What one press of the Update prices button does (lib/prices/manual), by
// the time in Karachi. In market hours the all-share page is read once, for
// every share's price now. After the close the day's closing file is fetched
// for the official closes, and while it is not out yet the page is read
// instead. Before the open, at weekends and on holidays only a closing file
// still missing is fetched. A press within 15 minutes of the last read reads
// nothing, so the site is asked little. Pure, so scripts/test-manual-prices.ts
// runs it.

import { isWeekday, lastTradingDay } from "./sweep";

export const MANUAL_GAP_MS = 15 * 60_000;
const OPEN = 9 * 60 + 15; // the pre-open
const CLOSE = 15 * 60 + 35; // Monday to Thursday, a few minutes after the close
const CLOSE_FRIDAY = 16 * 60 + 35; // Friday's second session ends at 16:30

export type ManualStep = "wait" | "none" | "close" | "live" | "close-then-live";
export type ManualPlan = { step: ManualStep; day: string; nextAt?: number };

export function manualPlan(i: { now: number; holidays: Set<string>; lastAt: number | null; latestFile: string | null }): ManualPlan {
  const pk = new Date(i.now + 5 * 3600_000);
  const today = pk.toISOString().slice(0, 10);
  if (i.lastAt != null && i.now - i.lastAt < MANUAL_GAP_MS) return { step: "wait", day: today, nextAt: i.lastAt + MANUAL_GAP_MS };
  const minutes = pk.getUTCHours() * 60 + pk.getUTCMinutes();
  const trading = isWeekday(today) && !i.holidays.has(today);
  const close = pk.getUTCDay() === 5 ? CLOSE_FRIDAY : CLOSE;
  if (trading && minutes >= OPEN && minutes < close) return { step: "live", day: today };
  if (trading && minutes >= close) return { step: i.latestFile != null && i.latestFile >= today ? "none" : "close-then-live", day: today };
  const last = lastTradingDay(today, i.holidays);
  return { step: i.latestFile != null && i.latestFile >= last ? "none" : "close", day: last };
}
