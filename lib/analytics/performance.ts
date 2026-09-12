// Performance arithmetic on the benchmark series (lib/timeseries/portfolio-
// history.ts): monthly returns by year, drawdowns, daily profit, and the
// summary figures a dashboard card wants. Pure functions; nothing here reads
// a database.

import type { BenchmarkPoint } from "@/lib/timeseries/portfolio-history";

export type MonthlyCell = { year: number; month: number; ret: number }; // ret as a fraction

export type MonthlyTable = {
  years: number[];
  cells: Map<string, number>; // "2026-03" -> return
  ytd: Map<number, number>; // per year, compounded over its months
  best: MonthlyCell | null;
  worst: MonthlyCell | null;
  positiveShare: number;
  months: number;
};

const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

// Month-end values of an index series, then each month's return (the first
// month runs from the series' first point).
export function monthlyReturns(points: Array<{ date: string; v: number | null }>): MonthlyCell[] {
  const ends = new Map<string, number>();
  let firstV: number | null = null;
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v)) continue;
    if (firstV == null) firstV = p.v;
    ends.set(p.date.slice(0, 7), p.v);
  }
  const months = [...ends.keys()].sort();
  const out: MonthlyCell[] = [];
  let prev = firstV;
  for (const k of months) {
    const v = ends.get(k)!;
    if (prev != null && prev > 0) {
      const ret = v / prev - 1;
      if (!(k === months[0] && ret === 0)) out.push({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), ret });
    }
    prev = v;
  }
  return out;
}

export function monthlyTable(cells: MonthlyCell[]): MonthlyTable {
  const map = new Map<string, number>();
  const ytd = new Map<number, number>();
  const years = new Set<number>();
  let best: MonthlyCell | null = null, worst: MonthlyCell | null = null, pos = 0;
  for (const c of cells) {
    map.set(key(c.year, c.month), c.ret);
    years.add(c.year);
    ytd.set(c.year, ((ytd.get(c.year) ?? 0) + 1) * (1 + c.ret) - 1);
    if (!best || c.ret > best.ret) best = c;
    if (!worst || c.ret < worst.ret) worst = c;
    if (c.ret > 0) pos++;
  }
  return { years: [...years].sort((a, b) => b - a), cells: map, ytd, best, worst, positiveShare: cells.length ? pos / cells.length : 0, months: cells.length };
}

export type Drawdown = { series: Array<{ date: string; dd: number }>; max: number; peakDate: string; troughDate: string; recoveredOn: string | null; current: number };

export function drawdowns(points: Array<{ date: string; v: number | null }>): Drawdown {
  let peak = -Infinity, peakDate = "", max = 0, maxPeakDate = "", troughDate = "", recoveredOn: string | null = null;
  const series: Array<{ date: string; dd: number }> = [];
  let inMax = false;
  for (const p of points) {
    if (p.v == null) continue;
    if (p.v >= peak) {
      if (inMax && recoveredOn == null) recoveredOn = p.date;
      peak = p.v;
      peakDate = p.date;
    }
    const dd = peak > 0 ? p.v / peak - 1 : 0;
    series.push({ date: p.date, dd });
    if (dd < max) {
      max = dd;
      maxPeakDate = peakDate;
      troughDate = p.date;
      inMax = true;
      recoveredOn = null;
    }
  }
  return { series, max, peakDate: maxPeakDate, troughDate, recoveredOn, current: series.length ? series[series.length - 1].dd : 0 };
}

export type DailyPnl = { date: string; ret: number; profit: number; value: number };

// Daily profit from the time-weighted path: yesterday's holdings at today's
// prices, so a buy made today is not counted as a gain.
export function dailyPnl(points: BenchmarkPoint[]): DailyPnl[] {
  const out: DailyPnl[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.portfolio == null || b.portfolio == null || a.portfolio <= 0) continue;
    const ret = b.portfolio / a.portfolio - 1;
    out.push({ date: b.date, ret, profit: a.portfolioValue * ret, value: b.portfolioValue });
  }
  return out;
}

export type PerfSummary = {
  from: string;
  to: string;
  days: number;
  twrPct: number; // total time-weighted return over the window
  benchPct: number | null;
  cagrPct: number | null;
  volPct: number | null; // annualised, from daily returns
  beta: number | null;
  sharpe: number | null; // against the risk-free index when present
  maxDrawdownPct: number;
  bestDay: DailyPnl | null;
  worstDay: DailyPnl | null;
  upDaysShare: number;
};

export function summarise(points: BenchmarkPoint[]): PerfSummary | null {
  const usable = points.filter((p) => p.portfolio != null);
  if (usable.length < 2) return null;
  const first = usable[0], last = usable[usable.length - 1];
  const days = Math.max(1, (Date.parse(last.date) - Date.parse(first.date)) / 86400000);
  const twr = last.portfolio! / first.portfolio! - 1;
  const bench = first.kse100 != null && last.kse100 != null ? last.kse100 / first.kse100 - 1 : null;
  const rets: number[] = [], brets: number[] = [], rf: number[] = [];
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1], b = usable[i];
    rets.push(b.portfolio! / a.portfolio! - 1);
    brets.push(a.kse100 != null && b.kse100 != null && a.kse100 > 0 ? b.kse100 / a.kse100 - 1 : NaN);
    rf.push(a.riskFree != null && b.riskFree != null && a.riskFree > 0 ? b.riskFree / a.riskFree - 1 : NaN);
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
  const m = mean(rets);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, rets.length - 1));
  const pairs = rets.map((r, i) => [r, brets[i]] as const).filter(([, b]) => Number.isFinite(b));
  let beta: number | null = null;
  if (pairs.length > 20) {
    const mb = mean(pairs.map((p) => p[1])), mr = mean(pairs.map((p) => p[0]));
    let cov = 0, vb = 0;
    for (const [r, b] of pairs) {
      cov += (r - mr) * (b - mb);
      vb += (b - mb) ** 2;
    }
    beta = vb > 0 ? cov / vb : null;
  }
  const rfPairs = rets.map((r, i) => r - (Number.isFinite(rf[i]) ? rf[i] : 0));
  const ex = mean(rfPairs);
  const sharpe = sd > 0 && rets.length > 20 ? (ex / sd) * Math.sqrt(252) : null;
  const dd = drawdowns(usable.map((p) => ({ date: p.date, v: p.portfolio })));
  const pnl = dailyPnl(usable);
  const best = pnl.reduce<DailyPnl | null>((b, d) => (!b || d.ret > b.ret ? d : b), null);
  const worst = pnl.reduce<DailyPnl | null>((b, d) => (!b || d.ret < b.ret ? d : b), null);
  return {
    from: first.date,
    to: last.date,
    days,
    twrPct: twr * 100,
    benchPct: bench == null ? null : bench * 100,
    cagrPct: days >= 180 ? (Math.pow(1 + twr, 365 / days) - 1) * 100 : null,
    volPct: rets.length > 20 ? sd * Math.sqrt(252) * 100 : null,
    beta,
    sharpe,
    maxDrawdownPct: dd.max * 100,
    bestDay: best,
    worstDay: worst,
    upDaysShare: pnl.length ? pnl.filter((d) => d.ret > 0).length / pnl.length : 0,
  };
}
