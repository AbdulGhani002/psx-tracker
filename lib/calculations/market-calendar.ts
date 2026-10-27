// The market's dates, worked out by the app instead of typed in. The ones
// set by a rule come from the rule: PSX futures expire on a month's last
// Friday (the trading day before it when that is a holiday), CPI comes out
// on the first working day, results are due 30, 60 and 120 days after a
// quarter, half-year or year ends, and the index reviews come in March and
// April, May, September and October, and November. T-bill auctions follow
// the last one kept, a fortnight apart. MPC days are caught from the news
// headlines that announce them (and SBP's yearly schedule when it is
// published), and the policy rate decided from the articles that report it.
// Pure, so scripts/test-market-calendar.ts runs it.

export type CalEvent = { date: string; title: string; kind: string; about: boolean; source: string };

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const t = (d: string) => Date.parse(d + "T00:00:00Z");
const pad = (n: number) => String(n).padStart(2, "0");
const isWeekend = (d: string) => [0, 6].includes(new Date(t(d)).getUTCDay());
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The month's last Friday, or the trading day before it when it is a holiday.
export function futuresExpiry(year: number, month: number, holidays: Set<string>): string {
  let d = t(`${year}-${pad(month)}-01`) + 40 * DAY;
  d = t(iso(d).slice(0, 7) + "-01") - DAY; // the month's last day
  while (new Date(d).getUTCDay() !== 5) d -= DAY;
  while (holidays.has(iso(d)) || isWeekend(iso(d))) d -= DAY;
  return iso(d);
}

export function firstWorkingDay(year: number, month: number, holidays: Set<string>): string {
  let d = t(`${year}-${pad(month)}-01`);
  while (isWeekend(iso(d)) || holidays.has(iso(d))) d += DAY;
  return iso(d);
}

// Every rule date from `from` to `to`.
export function ruleEvents(from: string, to: string, holidays: Set<string>): CalEvent[] {
  const out: CalEvent[] = [];
  const add = (date: string, title: string, kind: string, about = false) => {
    if (date >= from && date <= to) out.push({ date, title, kind, about, source: "rule" });
  };
  const [y0, m0] = from.split("-").map(Number);
  const [y1, m1] = to.split("-").map(Number);
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    add(futuresExpiry(y, m, holidays), "PSX futures expiry", "expiry");
    add(firstWorkingDay(y, m, holidays), `CPI for ${MONTHS[(m + 10) % 12]}`, "cpi", true);
    if (m === 3) {
      add(`${y}-03-01`, "Results due: half-year to December (June-year companies)", "results");
      add(`${y}-03-15`, "KSE-100 notice and KSE-30 changes", "index", true);
    }
    if (m === 4) {
      add(`${y}-04-01`, "KSE-100 recomposition takes effect", "index");
      add(`${y}-04-30`, "Results due: December-year annual, quarters to March", "results");
    }
    if (m === 5) add(`${y}-05-15`, "KMI-30 review", "index", true);
    if (m === 8) add(`${y}-08-29`, "Results due: half-year to June (December-year companies)", "results");
    if (m === 9) add(`${y}-09-15`, "KSE-100 notice and KSE-30 changes", "index", true);
    if (m === 10) {
      add(`${y}-10-01`, "KSE-100 recomposition takes effect", "index");
      add(`${y}-10-28`, "Results due: June-year annual with AGMs", "results");
      add(`${y}-10-30`, "Results due: quarters to September", "results");
    }
    if (m === 11) add(`${y}-11-15`, "KMI-30 review", "index", true);
  }
  return out;
}

// The next T-bill auctions: a fortnight after the last one kept.
export function auctionEvents(lastAuction: string | null, from: string, to: string): CalEvent[] {
  if (!lastAuction) return [];
  const out: CalEvent[] = [];
  for (let d = t(lastAuction) + 14 * DAY; d <= t(to); d += 14 * DAY) if (iso(d) >= from) out.push({ date: iso(d), title: "T-bill auction", kind: "auction", about: true, source: "rule" });
  return out;
}

const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const monthNo = (s: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3).toLowerCase()) + 1;

// The year a day and month without one fall in: the next such date on or
// after `ref`, unless that is over ten months away (then the one just gone).
function dateFrom(day: number, month: number, ref: string, year?: number): string | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  if (year) return `${year}-${pad(month)}-${pad(day)}`;
  const y = Number(ref.slice(0, 4));
  for (const cand of [`${y}-${pad(month)}-${pad(day)}`, `${y + 1}-${pad(month)}-${pad(day)}`]) if (cand >= iso(t(ref) - 3 * DAY)) return cand;
  return null;
}

// A headline that names the day the State Bank announces its policy: "SBP to
// announce monetary policy on May 20", "Monetary policy to be announced on
// Friday 29th September", "MPC meeting on Monday, October 26".
export function mpcFromHeadline(headline: string, today: string): string | null {
  const h = headline.replace(/-/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (!/monetary policy|\bmpc\b/.test(h) || !/\bon\b/.test(h)) return null;
  if (/decided|kept|keeps|cut|cuts|raised|raises|hike|hikes|unchanged|minutes|expects|survey|poll/.test(h)) return null;
  const tail = h.slice(h.search(/\bon\b/));
  let m = tail.match(new RegExp(`\\bon (?:[a-z]+day,? )?(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE}(?: (\\d{4}))?`));
  let date: string | null = null;
  if (m) date = dateFrom(Number(m[1]), monthNo(m[2]), today, m[3] ? Number(m[3]) : undefined);
  else {
    m = tail.match(new RegExp(`\\bon (?:[a-z]+day,? )?${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?`));
    if (m) date = dateFrom(Number(m[2]), monthNo(m[1]), today, m[3] ? Number(m[3]) : undefined);
  }
  return date && date >= today && t(date) - t(today) <= 45 * DAY ? date : null;
}

// SBP's yearly MPC schedule as an article prints it: every date in the next
// thirteen months; at least four, or it is not a schedule.
export function mpcFromSchedule(text: string, today: string): string[] {
  const s = text.replace(/\s+/g, " ");
  const found = new Set<string>();
  for (const m of s.matchAll(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE},? (\\d{4})`, "gi"))) {
    const d = dateFrom(Number(m[1]), monthNo(m[2]), today, Number(m[3]));
    if (d) found.add(d);
  }
  for (const m of s.matchAll(new RegExp(`${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})`, "gi"))) {
    const d = dateFrom(Number(m[2]), monthNo(m[1]), today, Number(m[3]));
    if (d) found.add(d);
  }
  const ahead = [...found].filter((d) => d > today && t(d) - t(today) <= 400 * DAY).sort();
  return ahead.length >= 4 ? ahead : [];
}

// A headline that reports the State Bank's decision on its policy rate: "SBP
// hikes policy rate by 0.5% to 12%", "SBP keeps policy rate unchanged at
// 11%". Not a forecast, a poll or the market's reaction.
export function policyDecisionHeadline(headline: string): boolean {
  const h = headline.replace(/-/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (!/\b(sbp|mpc|state bank)\b/.test(h) || !/\b(policy|interest|discount|key) rate\b/.test(h)) return false;
  if (!/\b(hikes?|hiked|raises?|raised|increases?|increased|cuts?|slash(es|ed)?|reduces?|reduced|lowers?|lowered|keeps?|kept|maintains?|maintained|holds?|held|unchanged|leaves?|left)\b/.test(h)) return false;
  return !/\b(expect\w*|likely|poll|survey\w*|analysts?|may|might|could|should|seen|forecast\w*|preview|ahead|will|what|how|why|before|after|if)\b/.test(h);
}

export type PolicyDecision = { decided: string; from: string; rate: number; move: "up" | "down" | "same" };

const rateIn = (s: string): number | null => {
  const m = s.match(/\b(?:to|at)\s+(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|per\s?cent\b|pc\b)/i);
  const v = m ? Number(m[1]) : NaN;
  return v >= 1 && v <= 40 ? v : null;
};

function dateAfter(text: string, lead: string): string | null {
  let m = text.match(new RegExp(`${lead} (?:[a-z]+day,? )?${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})`, "i"));
  if (m) return dateFrom(Number(m[2]), monthNo(m[1]), "2000-01-01", Number(m[3]));
  m = text.match(new RegExp(`${lead} (?:[a-z]+day,? )?(\\d{1,2})(?:st|nd|rd|th)? ${MONTH_RE},? (\\d{4})`, "i"));
  return m ? dateFrom(Number(m[1]), monthNo(m[2]), "2000-01-01", Number(m[3])) : null;
}

// The decision such an article reports: the rate (from the headline, else the
// sentence on the policy rate), the meeting day (else the day it was
// published) and the day it takes effect (stated, else the next day, as
// SBP's own history dates every step).
export function policyDecisionFrom(headline: string, text: string, published: string | null): PolicyDecision | null {
  if (!policyDecisionHeadline(headline)) return null;
  const h = headline.toLowerCase();
  const move = /\b(hike|raise|increase)/.test(h) ? "up" : /\b(cut|slash|reduce|lower)/.test(h) ? "down" : "same";
  const at = text.search(/policy rate/i);
  const rate = rateIn(headline) ?? (at >= 0 ? rateIn(text.slice(at, at + 300)) : null);
  const decided = dateAfter(text, "meeting(?: held)? on") ?? (published && /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null);
  if (rate == null || !decided) return null;
  const stated = dateAfter(text, "(?:with )?effect(?:ive)? (?:from|on)");
  const from = stated && stated >= decided ? stated : iso(t(decided) + DAY);
  return { decided, from, rate, move };
}

// Mettis Global's policy-rate chart: a row a meeting month ("Oct ,26", 12),
// oldest first. Each month is dated by its MPC day kept, and the decision
// takes effect the next day; a month with no MPC day kept is left out.
export function chartDecisions(rows: Array<{ Value?: unknown; DateTime?: unknown }>, mpcDays: string[], today: string): PolicyDecision[] {
  const out: PolicyDecision[] = [];
  let prev: number | null = null;
  for (const r of rows) {
    const m = String(r.DateTime ?? "").trim().match(/^([A-Za-z]{3})[a-z]*\s*,\s*(\d{2})$/);
    const rate = Number(r.Value);
    if (!m || monthNo(m[1]) < 1 || !(rate >= 1 && rate <= 40)) continue;
    const month = `20${m[2]}-${pad(monthNo(m[1]))}`;
    const day = mpcDays.filter((d) => d.startsWith(month) && d <= today).sort().pop();
    if (day) out.push({ decided: day, from: iso(t(day) + DAY), rate, move: prev == null || rate === prev ? "same" : rate > prev ? "up" : "down" });
    prev = rate;
  }
  return out;
}

// The last MPC day two to seven days gone with no decision read within a day
// of it: the rate may have moved without the app knowing.
export function missedMpc(mpcDays: string[], decided: string[], today: string): string | null {
  const day = mpcDays.filter((d) => t(today) - t(d) >= 2 * DAY && t(today) - t(d) <= 7 * DAY).sort().pop();
  if (!day) return null;
  return decided.some((d) => Math.abs(t(d) - t(day)) <= DAY) ? null : day;
}

export function missedMpcMessage(day: string): string {
  const d = new Date(t(day)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `⚠️ <b>MPC of ${d}</b>: no decision found in the news. The policy rate may be out of date.`;
}

export function policyMessage(step: { from: string; rate: number }, before: number | null): string {
  const d = new Date(t(step.from)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const ch = before == null || before === step.rate ? "" : `, ${step.rate > before ? "up" : "down"} ${Math.abs(step.rate - before).toFixed(2)}`;
  return `🏦 <b>Policy rate ${step.rate}%</b>${ch}, from ${d}.`;
}

// The rule's dates where nothing announced covers the same kind that day.
export function mergeEvents(announced: CalEvent[], ruled: CalEvent[]): CalEvent[] {
  const taken = new Set(announced.map((e) => `${e.date}|${e.kind}`));
  return [...announced, ...ruled.filter((e) => !taken.has(`${e.date}|${e.kind}`))].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// The trading day after `today` (weekends and holidays skipped).
export function nextTradingDay(today: string, holidays: Set<string>): string {
  let d = t(today) + DAY;
  while (isWeekend(iso(d)) || holidays.has(iso(d))) d += DAY;
  return iso(d);
}

// The evening's alert: every date after today up to the next trading day.
export function eventsMessage(events: CalEvent[], today: string, holidays: Set<string>): string | null {
  const until = nextTradingDay(today, holidays);
  const due = events.filter((e) => e.date > today && e.date <= until);
  if (due.length === 0) return null;
  const day = (d: string) => new Date(t(d)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  const byDate = new Map<string, CalEvent[]>();
  for (const e of due) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const lines = [...byDate].map(([d, es]) => `${d === iso(t(today) + DAY) ? "Tomorrow" : day(d)}: ${es.map((e) => `${e.title}${e.about ? " (about)" : ""}`).join(" · ")}`);
  return `📅 <b>Coming up</b>\n${lines.join("\n")}`;
}
