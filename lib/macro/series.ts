// The macro state at a month's end, as it was known then: the SBP policy rate
// and its direction, inflation, growth, and the world's prices that move
// Pakistan's market (oil, gold, the rupee, US and emerging-market stocks, the
// dollar, US yields). Pure, so scripts/test-macro.ts runs it, and the same
// numbers feed the research (scripts/macro-lab.ts) and the live strategy page.

export type Point = [string, number]; // [yyyy-mm-dd, value], ascending
export type CpiPoint = { period: string; index: number }; // PBS, yyyy-mm

export type MacroInputs = {
  policy: Point[]; // SBP steps: [effective date, rate %]
  cpiMonthly: CpiPoint[]; // PBS CPI index, monthly
  cpiAnnual: Array<[number, number]>; // World Bank, [year, % change]
  gdpAnnual: Array<[number, number]>; // World Bank, [year, % growth]
  oil: Point[];
  gold: Point[];
  usdpkr: Point[];
  spx: Point[];
  em: Point[];
  dxy: Point[];
  us10y: Point[]; // yield, %
  market: Point[]; // the PSX equal-weight index
};

// The last value on or before a date.
export function valueOn(s: Point[], date: string): number | null {
  let lo = 0, hi = s.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= date) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at >= 0 ? s[at][1] : null;
}

// The same day `months` earlier, clamped to that month's last day.
export function monthsBack(date: string, months: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1, d = Number(date.slice(8, 10));
  const t = new Date(Date.UTC(y, m - months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

const dayBefore = (date: string) => new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

// ln(now / `months` earlier). `lag` reads both a day earlier: markets that
// close after Karachi's (oil, gold, New York) are not known at its close.
export function logChange(s: Point[], date: string, months: number, lag = false): number | null {
  const at = lag ? dayBefore(date) : date;
  const a = valueOn(s, at), b = valueOn(s, monthsBack(at, months));
  return a != null && b != null && a > 0 && b > 0 && s[0][0] <= monthsBack(at, months) ? Math.log(a / b) : null;
}

// Inflation known at a date: PBS's year-on-year from its monthly index (a
// month's figure comes out in the first days of the next, so the latest known
// is last month's), or, before PBS's series, the World Bank's figure for the
// previous calendar year.
export function cpiOn(date: string, monthly: CpiPoint[], annual: Array<[number, number]>): number | null {
  const known = monthsBack(date, 1).slice(0, 7);
  const byPeriod = new Map(monthly.map((p) => [p.period, p.index]));
  const now = [...monthly].reverse().find((p) => p.period <= known);
  if (now) {
    const y = Number(now.period.slice(0, 4)), m = now.period.slice(5);
    const ago = byPeriod.get(`${y - 1}-${m}`);
    if (ago && ago > 0) return (now.index / ago - 1) * 100;
  }
  const prior = annual.find(([y]) => y === Number(date.slice(0, 4)) - 1);
  return prior ? prior[1] : null;
}

// Growth known at a date: last year's from July (the World Bank publishes
// mid-year), the year before that until then.
export function gdpOn(date: string, annual: Array<[number, number]>): number | null {
  const y = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) >= 7 ? 1 : 2);
  return annual.find(([yy]) => yy === y)?.[1] ?? null;
}

// The market's fall from its high over the past year, and its own moves.
function drawdown(s: Point[], date: string): number | null {
  const from = monthsBack(date, 12);
  let hi = 0, at: number | null = null;
  for (const [d, v] of s) {
    if (d < from) continue;
    if (d > date) break;
    hi = Math.max(hi, v);
    at = v;
  }
  return at != null && hi > 0 ? at / hi - 1 : null;
}

export const MACRO_NAMES = [
  "policy", "policyChg6", "policyChg12", "cpi", "realRate", "gdp",
  "oil3", "oil12", "gold3", "gold12", "pkr3", "pkr12",
  "spx3", "spx12", "em3", "dxy3", "us10yChg3",
  "mktDd12", "mktRet3", "mktRet12",
] as const;
export type MacroName = (typeof MACRO_NAMES)[number];

// The state at a month's end, as numbers in MACRO_NAMES order (null unknown).
export function macroState(date: string, i: MacroInputs): Array<number | null> {
  const pol = valueOn(i.policy, date);
  const pol6 = valueOn(i.policy, monthsBack(date, 6)), pol12 = valueOn(i.policy, monthsBack(date, 12));
  const cpi = cpiOn(date, i.cpiMonthly, i.cpiAnnual);
  const ten = valueOn(i.us10y, dayBefore(date)), ten3 = valueOn(i.us10y, monthsBack(dayBefore(date), 3));
  const v: Record<MacroName, number | null> = {
    policy: pol,
    policyChg6: pol != null && pol6 != null ? pol - pol6 : null,
    policyChg12: pol != null && pol12 != null ? pol - pol12 : null,
    cpi,
    realRate: pol != null && cpi != null ? pol - cpi : null,
    gdp: gdpOn(date, i.gdpAnnual),
    oil3: logChange(i.oil, date, 3, true),
    oil12: logChange(i.oil, date, 12, true),
    gold3: logChange(i.gold, date, 3, true),
    gold12: logChange(i.gold, date, 12, true),
    pkr3: logChange(i.usdpkr, date, 3),
    pkr12: logChange(i.usdpkr, date, 12),
    spx3: logChange(i.spx, date, 3, true),
    spx12: logChange(i.spx, date, 12, true),
    em3: logChange(i.em, date, 3, true),
    dxy3: logChange(i.dxy, date, 3, true),
    us10yChg3: ten != null && ten3 != null ? ten - ten3 : null,
    mktDd12: drawdown(i.market, date),
    mktRet3: logChange(i.market, date, 3),
    mktRet12: logChange(i.market, date, 12),
  };
  return MACRO_NAMES.map((n) => v[n]);
}
