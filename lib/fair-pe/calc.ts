// Sectors' P/E and dividend yield at each 30 June and now, and the fair P/E at
// the rates you enter. Pure, so scripts/test-fair-pe.ts runs it.
//
// Value: today's shares × the close adjusted for later bonus and split
// issues, which is the shares then × the price then. Profit: the last full
// year ended by the date, if it ended within 15 months. A sector's P/E is its
// profitable companies' value over their profit, from two companies on.
// Dividend yield: the cash dividends gone ex in the 12 months to the date
// over the price then, weighted by value; payout: those dividends over the
// profit. A year whose profit figures cover under 60% of the sector's value
// has no P/E: the companies it has would not stand for the sector.
//
// Fair P/E: each sector's earnings yield (100 / P/E) at each 30 June against
// that year's 12-month T-bill (or policy rate), a straight line through them
// (least squares, from three years; with fewer, the yield moves point for
// point with the rate). Fair earnings yield = the line at your rate + any
// extra risk you add; beyond the rates seen it moves with the rate at most
// point for point. The fair P/E is 100 over it, the range from the line's
// largest miss in those years. Fair dividend yield = the fair earnings yield
// × the sector's usual payout. A share's fair P/E is its sector's times the
// share's usual P/E against its sector.

export type CompanyInput = {
  symbol: string;
  sector: string;
  shares: number;
  fyEndMonth: number; // 1-12
  annual: Array<{ fiscalYear: number; profit: number }>; // rupees
  at: Record<string, { adj: number | null; actual: number | null }>; // each date: adjusted close, actual close
  priceNow: number | null;
  cash: Array<{ date: string; cash: number }>; // rupees a share then, by ex-date
};

export type Point = { pe: number | null; dy: number | null; payout: number | null; value: number; companies: number; profitable: number; covered: number };
export type CompanyPoint = { pe: number | null; dy: number | null };
export type SectorHistory = { sector: string; years: Record<string, Point>; now: Point };
export type CompanyHistory = { symbol: string; sector: string; years: Record<string, CompanyPoint>; now: CompanyPoint };
export type History = { dates: string[]; today: string; all: SectorHistory; sectors: SectorHistory[]; companies: CompanyHistory[]; excluded: Array<{ symbol: string; why: string }> };

export type Macro = { tbill?: number | null; policy?: number | null; cpi?: number | null };
// `skip`: years left out of the lines; `watch`: shares shown besides those held.
export type FairPeInputs = { now: Macro & { extraRisk?: number | null }; years: Record<string, Macro>; skip?: string[]; watch?: string[] };
export type FairPeBoard = { history: History; inputs: FairPeInputs; known: { now: Macro; years: Record<string, Macro> }; held: string[]; builtAt: string };

const DAY = 86400000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const MIN_COMPANIES = 2;
export const MIN_COVERED = 0.6;

// The last day of a fiscal year that ends in month `m` of `year`.
export const yearEnd = (year: number, m: number) => iso(Date.UTC(year, m, 0));

export function profitAt(c: Pick<CompanyInput, "annual" | "fyEndMonth">, date: string): number | null {
  let best: { end: string; profit: number } | null = null;
  for (const a of c.annual) {
    if (!Number.isFinite(a.profit)) continue;
    const end = yearEnd(a.fiscalYear, c.fyEndMonth);
    if (end <= date && (!best || end > best.end)) best = { end, profit: a.profit };
  }
  return best && t(date) - t(best.end) <= 460 * DAY ? best.profit : null;
}

export function cashIn(c: Pick<CompanyInput, "cash">, date: string): number {
  const from = iso(t(date) - 365 * DAY);
  return c.cash.reduce((s, e) => (e.date > from && e.date <= date ? s + e.cash : s), 0);
}

type Row = { value: number | null; profit: number | null; dy: number | null };

// `date` null is now.
function rowOf(c: CompanyInput, date: string | null, today: string): Row {
  const on = date ?? today;
  const valuePrice = date ? c.at[date]?.adj ?? null : c.priceNow;
  const actual = date ? c.at[date]?.actual ?? null : c.priceNow;
  const value = valuePrice != null && valuePrice > 0 && c.shares > 0 ? valuePrice * c.shares : null;
  const dy = actual != null && actual > 0 ? (cashIn(c, on) / actual) * 100 : null;
  return { value, profit: profitAt(c, on), dy };
}

export function aggregate(rows: Row[]): Point {
  let value = 0, companies = 0, dyNum = 0, dyBase = 0, peValue = 0, profit = 0, profitable = 0, paid = 0, known = 0;
  for (const r of rows) {
    if (r.value == null || !(r.value > 0)) continue;
    companies++;
    value += r.value;
    if (r.profit != null) known += r.value;
    if (r.dy != null) {
      dyNum += r.dy * r.value;
      dyBase += r.value;
    }
    if (r.profit != null && r.profit > 0) {
      profitable++;
      peValue += r.value;
      profit += r.profit;
      paid += ((r.dy ?? 0) / 100) * r.value;
    }
  }
  const covered = value > 0 ? known / value : 0;
  const enough = profitable >= MIN_COMPANIES && profit > 0 && covered >= MIN_COVERED;
  return { pe: enough ? peValue / profit : null, dy: dyBase > 0 ? dyNum / dyBase : null, payout: enough ? paid / profit : null, value, companies, profitable, covered };
}

const pointOf = (r: Row): CompanyPoint => ({ pe: r.value != null && r.profit != null && r.profit > 0 ? r.value / r.profit : null, dy: r.dy });

export function buildHistory(companies: CompanyInput[], dates: string[], today: string, excluded: History["excluded"] = []): History {
  const histOf = (sector: string, cs: CompanyInput[]): SectorHistory => ({
    sector,
    years: Object.fromEntries(dates.map((d) => [d, aggregate(cs.map((c) => rowOf(c, d, today)))])),
    now: aggregate(cs.map((c) => rowOf(c, null, today))),
  });
  const bySector = new Map<string, CompanyInput[]>();
  for (const c of companies) {
    const list = bySector.get(c.sector) ?? [];
    list.push(c);
    bySector.set(c.sector, list);
  }
  return {
    dates,
    today,
    all: histOf("All", companies),
    sectors: [...bySector].map(([s, cs]) => histOf(s, cs)).sort((a, b) => b.now.value - a.now.value),
    companies: companies.map((c) => ({ symbol: c.symbol, sector: c.sector, years: Object.fromEntries(dates.map((d) => [d, pointOf(rowOf(c, d, today))])), now: pointOf(rowOf(c, null, today)) })),
    excluded,
  };
}

export const rateOf = (m?: Macro | null): number | null => (m?.tbill != null ? m.tbill : m?.policy != null ? m.policy : null);
export const yearOf = (date: string) => date.slice(0, 4);

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A sector's earnings yield against the rate: ey = a + b × rate over the
// years used. `b` is how many points the yield moved per point of rate.
export type Fit = { a: number; b: number; rmin: number; rmax: number; miss: number; years: number };

export function fitOf(h: SectorHistory, dates: string[], years: Record<string, Macro>, skip: string[] = []): Fit | null {
  const pts = dates.flatMap((d) => {
    const pe = h.years[d]?.pe, r = rateOf(years[yearOf(d)]);
    return !skip.includes(yearOf(d)) && pe != null && pe > 0 && r != null ? [{ r, ey: 100 / pe }] : [];
  });
  if (pts.length === 0) return null;
  const rs = pts.map((p) => p.r);
  const rmin = Math.min(...rs), rmax = Math.max(...rs);
  let a: number, b: number;
  if (pts.length >= 3 && rmax - rmin >= 1) {
    const mr = rs.reduce((s, x) => s + x, 0) / pts.length, me = pts.reduce((s, p) => s + p.ey, 0) / pts.length;
    const cov = pts.reduce((s, p) => s + (p.r - mr) * (p.ey - me), 0), vr = pts.reduce((s, p) => s + (p.r - mr) ** 2, 0);
    b = Math.min(4, Math.max(0, cov / vr));
    a = me - b * mr;
  } else {
    b = 1;
    a = median(pts.map((p) => p.ey - p.r))!;
  }
  const miss = Math.max(...pts.map((p) => Math.abs(p.ey - (a + b * p.r))));
  return { a, b, rmin, rmax, miss, years: pts.length };
}

// The line at a rate; beyond the rates seen, at most point for point.
export function eyAt(f: Fit, rate: number): number {
  const inside = Math.min(Math.max(rate, f.rmin), f.rmax);
  return f.a + f.b * inside + Math.min(f.b, 1) * (rate - inside);
}

export type Fair = {
  peNow: number | null;
  dyNow: number | null;
  premiums: Array<{ date: string; premium: number }>;
  fit: Fit | null;
  payout: number | null;
  fairEy: number | null;
  fairPe: number | null;
  fairPeLow: number | null;
  fairPeHigh: number | null;
  fairDy: number | null;
};

// `years`: the rates at each 30 June, by year; `rateNow`: the rate for now;
// `extra`: points of risk on top; `skip`: years left out of the line.
export function fairOf(h: SectorHistory, dates: string[], years: Record<string, Macro>, rateNow: number | null, extra = 0, skip: string[] = []): Fair {
  const premiums = dates.flatMap((d) => {
    const pe = h.years[d]?.pe, r = rateOf(years[yearOf(d)]);
    return pe != null && pe > 0 && r != null ? [{ date: d, premium: 100 / pe - r }] : [];
  });
  const fit = fitOf(h, dates, years, skip);
  const payout = median(dates.filter((d) => !skip.includes(yearOf(d))).map((d) => h.years[d]?.payout).filter((x): x is number => x != null && x >= 0 && x <= 1.5));
  const peAt = (ey: number | null) => (ey != null && ey > 1 ? 100 / ey : null);
  const fairEy = rateNow != null && fit ? eyAt(fit, rateNow) + extra : null;
  return {
    peNow: h.now.pe,
    dyNow: h.now.dy,
    premiums,
    fit,
    payout,
    fairEy,
    fairPe: peAt(fairEy),
    fairPeLow: fairEy != null && fit ? peAt(fairEy + fit.miss) : null,
    fairPeHigh: fairEy != null && fit ? peAt(fairEy - fit.miss) : null,
    fairDy: fairEy != null && fairEy > 1 && payout != null ? fairEy * payout : null,
  };
}

// A share against its sector: its P/E over the sector's at each 30 June (the
// median, from two years on), times the sector's fair P/E.
export function shareFair(c: CompanyHistory, h: SectorHistory, dates: string[], sectorFairPe: number | null): { peNow: number | null; dyNow: number | null; ratio: number | null; fairPe: number | null } {
  const ratios = dates.flatMap((d) => {
    const a = c.years[d]?.pe, b = h.years[d]?.pe;
    return a != null && b != null && a > 0 && b > 0 ? [a / b] : [];
  });
  const ratio = ratios.length >= 2 ? median(ratios) : null;
  return { peNow: c.now.pe, dyNow: c.now.dy, ratio, fairPe: sectorFairPe != null && ratio != null ? sectorFairPe * ratio : null };
}

// Year-on-year CPI inflation for a month (yyyy-mm) from the monthly index.
export function cpiYoy(history: Array<{ period: string; index: number }>, month: string): number | null {
  const by = new Map(history.map((p) => [p.period.slice(0, 7), p.index]));
  const a = by.get(month), b = by.get(`${Number(month.slice(0, 4)) - 1}${month.slice(4)}`);
  return a != null && b != null && b > 0 ? (a / b - 1) * 100 : null;
}
