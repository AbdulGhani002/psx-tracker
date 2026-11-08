// The one daily read of the exchange's site. On a trading day, at a random
// time after the close, the server goes through what it wants of the site
// once: the closing file and the index pages, then the company pages, which
// carry the announcements, dividends and results. One page at a time, with
// random gaps, so the day's reading takes 8 to 9 hours. The rest of the app
// reads the copies kept. Pure, so scripts/test-sweep.ts runs it.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START_FROM = 17 * 60; // minutes after midnight in Karachi
const START_SPREAD = 90;
export const MIN_GAP_MS = 4 * MINUTE;

export type GateRoute = "site" | "kept" | "none";

// Where the server's request goes. Only the sweep reads pages from the site;
// a day's closing file, a company's document and a POST (a closed address is
// asked once a week, lib/prices/dps) go as they are; a page comes from the
// copies kept; anything else (addresses the site has dropped) goes nowhere.
export function gateRoute(path: string, method: string, sweeping: boolean): GateRoute {
  if (sweeping || method !== "GET" || path.startsWith("/download/")) return "site";
  return /^\/(company|indices)(\/|$)/.test(path) ? "kept" : "none";
}

// A generator seeded by the day: random from one day to the next, the same
// on every tick of the day.
export function seeded(text: string): () => number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), h | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// The day's start, between 17:00 and 18:30 in Karachi, as a time.
export function sweepStart(day: string): number {
  const minutes = START_FROM + Math.floor(seeded(day)() * START_SPREAD);
  return Date.parse(day + "T00:00:00Z") + (minutes - 5 * 60) * MINUTE;
}

export const isWeekday = (day: string) => ![0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());

// How long the day's reading takes: 8 to 9 hours.
export const sweepLength = (rnd: () => number = Math.random) => 8 * HOUR + rnd() * HOUR;

// The wait before the next page: the time left shared over the pages left,
// half to one and a half of that at random, and never under four minutes.
export function nextGap(now: number, finishBy: number, left: number, rnd: () => number = Math.random): number {
  const share = Math.max(0, finishBy - now) / Math.max(1, left);
  return Math.max(MIN_GAP_MS, Math.round(share * (0.5 + rnd())));
}

function shuffled<T>(list: T[], rnd: () => number): T[] {
  const out = [...list];
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

// The day's list: the index pages, then the shares held and on the buy list,
// then those wished for and the rest, each group in random order and no page
// twice.
export function sweepItems(i: { indices: string[]; held: string[]; rest: string[]; wished: string[] }, rnd: () => number = Math.random): string[] {
  const page = (s: string) => `/company/${encodeURIComponent(s)}`;
  const all = [...shuffled(i.indices, rnd), ...shuffled(i.held.map(page), rnd), ...shuffled([...i.wished, ...i.rest.map(page)], rnd)];
  return [...new Set(all)];
}

// The morning report on the night's read, sent at 8 in Karachi (the read ends
// in the small hours), and the evening check at 8 pm, when a read that has
// not started will not.
export const REPORT_HOUR = 8;
export const LATE_HOUR = 20;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (day: string) => {
  const t = new Date(day + "T00:00:00Z");
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
};
const shortDay = (day: string) => dayLabel(day).slice(4);

// The trading day before `today`: a weekday that is not a holiday.
export function lastTradingDay(today: string, holidays: Set<string>): string {
  let t = Date.parse(today + "T00:00:00Z");
  for (let k = 0; k < 15; k++) {
    t -= DAY;
    const d = new Date(t).toISOString().slice(0, 10);
    if (isWeekday(d) && !holidays.has(d)) return d;
  }
  return new Date(t).toISOString().slice(0, 10);
}

export type ReadDone = { day: string; items: number; done: number; read: number; missed: number; finishedAt?: string | null };

// One line on the read for `day`: the pages, the closing prices of the
// shares held, the companies with something new on their page. A warning
// when it did not run, did not finish, missed pages or brought no prices.
export function readLine(i: { day: string; read: ReadDone | null; held: number; closes: number; lastClose: string | null; news: string[]; refusing: boolean }): { warn: boolean; text: string } {
  const head = `<b>Exchange read</b> ${dayLabel(i.day)}`;
  const prices =
    i.held === 0 ? "" : i.closes > 0 ? `closes for ${i.closes} of ${i.held} shares` : `no closes for ${shortDay(i.day)}${i.lastClose ? `, prices are from ${shortDay(i.lastClose)}` : ""}`;
  const news = i.news.length ? `new announcements: ${i.news.slice(0, 8).join(", ")}${i.news.length > 8 ? ` and ${i.news.length - 8} more` : ""}` : "no new announcements";
  const tail = [prices, news].filter(Boolean).join(", ");
  const r = i.read;
  if (!r || r.day !== i.day) return { warn: true, text: `⚠️ ${head} did not run. ${tail[0].toUpperCase()}${tail.slice(1)}.` };
  if (!r.finishedAt) return { warn: true, text: `⚠️ ${head} stopped at ${r.done} of ${r.items} pages${i.refusing ? ", the site is refusing" : ""}. ${tail[0].toUpperCase()}${tail.slice(1)}.` };
  const warn = r.missed > 0 || (i.held > 0 && i.closes < i.held);
  return { warn, text: `${warn ? "⚠️" : "📖"} ${head}: ${r.read} of ${r.items} pages${r.missed ? `, ${r.missed} missed` : ""}, ${tail}.` };
}

// The evening warning: a trading day whose read has not begun by 8 pm.
export function readLate(i: { today: string; hour: number; holidays: Set<string>; readDay: string | null }): string | null {
  if (i.hour < LATE_HOUR || !isWeekday(i.today) || i.holidays.has(i.today) || i.readDay === i.today) return null;
  return `⚠️ <b>Exchange read</b> has not started tonight (${dayLabel(i.today)}).`;
}

