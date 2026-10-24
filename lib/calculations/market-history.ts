// The KSE-100 month by month, and what it did in each kind of month: by the
// calendar (January to December) and by the State Bank's rate cycle (the
// direction of its last change). Where the exchange's own series is kept
// (from September 2021 on the server) it is used; before that the index is
// rebuilt from its current members: each one's free-float shares times its
// price adjusted for bonus and split issues, with each cash dividend added
// back in the month it went ex, as the KSE-100 (a total return index) does.
// Pure, so scripts/test-market-history.ts runs it.

export type MonthRet = { month: string; ret: number; source: "index" | "rebuilt" };

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

// The last close of each month.
export function monthEnds(bars: Array<{ date: string; close: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of [...bars].sort((a, c) => a.date.localeCompare(c.date))) if (b.close > 0) out.set(b.date.slice(0, 7), b.close);
  return out;
}

// Returns (%) of months whose month before has a close too.
export function indexMonthly(ends: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [m, c] of ends) {
    const p = ends.get(prevMonth(m));
    if (p && p > 0) out.set(m, (c / p - 1) * 100);
  }
  return out;
}

// The rebuilt index: each member's price change plus the dividends it went ex
// in the month (% of the price then), weighted by its value at the end of the
// month before. A month needs `minMembers` members priced at both ends.
export function rebuildMonthly(members: Array<{ units: number; ends: Map<string, number>; divPct: Map<string, number> }>, months: string[], minMembers = 20): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of months) {
    const p = prevMonth(m);
    let num = 0, den = 0, n = 0;
    for (const mem of members) {
      const a = mem.ends.get(p), b = mem.ends.get(m);
      if (!(a && a > 0 && b && b > 0 && mem.units > 0)) continue;
      const v = mem.units * a;
      num += v * (b / a - 1 + (mem.divPct.get(m) ?? 0) / 100);
      den += v;
      n++;
    }
    if (n >= minMembers && den > 0) out.set(m, (num / den) * 100);
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function corr(a: number[], b: number[]): number | null {
  if (a.length < 6) return null;
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

// The exchange's months where it has them, the rebuilt ones before; how the
// two agree on the months both have.
export function splice(real: Map<string, number>, rebuilt: Map<string, number>): { series: MonthRet[]; fit: { months: number; corr: number | null; meanAbsDiff: number | null } } {
  const firstReal = [...real.keys()].sort()[0] ?? "9999-99";
  const series: MonthRet[] = [];
  for (const [m, r] of [...rebuilt].sort((a, b) => a[0].localeCompare(b[0]))) if (m < firstReal) series.push({ month: m, ret: r, source: "rebuilt" });
  for (const [m, r] of [...real].sort((a, b) => a[0].localeCompare(b[0]))) series.push({ month: m, ret: r, source: "index" });
  const both = [...real.keys()].filter((m) => rebuilt.has(m)).sort();
  const a = both.map((m) => real.get(m)!), b = both.map((m) => rebuilt.get(m)!);
  return { series, fit: { months: both.length, corr: corr(a, b), meanAbsDiff: both.length ? mean(a.map((x, i) => Math.abs(x - b[i]))) : null } };
}

const LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export type MonthStat = { m: number; label: string; n: number; up: number; mean: number; median: number; best: { month: string; ret: number }; worst: { month: string; ret: number } };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

export function monthPatterns(series: MonthRet[]): { months: MonthStat[]; mean: number | null; n: number; from: string | null; to: string | null } {
  const months: MonthStat[] = [];
  for (let m = 1; m <= 12; m++) {
    const rows = series.filter((r) => Number(r.month.slice(5, 7)) === m);
    if (rows.length === 0) continue;
    const rets = rows.map((r) => r.ret);
    const best = rows.reduce((x, r) => (r.ret > x.ret ? r : x));
    const worst = rows.reduce((x, r) => (r.ret < x.ret ? r : x));
    months.push({ m, label: LABELS[m - 1], n: rows.length, up: rows.filter((r) => r.ret > 0).length, mean: mean(rets), median: median(rets), best: { month: best.month, ret: best.ret }, worst: { month: worst.month, ret: worst.ret } });
  }
  return { months, mean: series.length ? mean(series.map((r) => r.ret)) : null, n: series.length, from: series[0]?.month ?? null, to: series[series.length - 1]?.month ?? null };
}

// A cycle begins with the first change the opposite way to the last.
export type Turn = { date: string; kind: "cut" | "rise"; before: number; after: number };
export function turnsFromSteps(steps: Array<{ from: string; rate: number }>): Turn[] {
  const sorted = [...steps].sort((a, b) => a.from.localeCompare(b.from));
  const out: Turn[] = [];
  let prev: number | null = null, dir = 0;
  for (const s of sorted) {
    if (prev == null) {
      prev = s.rate;
      continue;
    }
    const d = Math.sign(s.rate - prev);
    if (d !== 0 && d !== dir) out.push({ date: s.from, kind: d < 0 ? "cut" : "rise", before: prev, after: s.rate });
    if (d !== 0) dir = d;
    prev = s.rate;
  }
  return out;
}

// A month's state: the direction of the last change made before it began.
export function stateOf(month: string, turns: Turn[]): "easing" | "tightening" | null {
  let state: "easing" | "tightening" | null = null;
  for (const t of turns) if (t.date < `${month}-01`) state = t.kind === "cut" ? "easing" : "tightening";
  return state;
}

export type CycleStats = { easing: { n: number; mean: number | null; up: number }; tightening: { n: number; mean: number | null; up: number }; t: number | null };

export function cycleStats(series: MonthRet[], turns: Turn[]): CycleStats {
  const e: number[] = [], g: number[] = [];
  for (const r of series) {
    const s = stateOf(r.month, turns);
    if (s === "easing") e.push(r.ret);
    else if (s === "tightening") g.push(r.ret);
  }
  const v = (xs: number[]) => {
    const m = mean(xs);
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  };
  const t = e.length > 2 && g.length > 2 ? (mean(e) - mean(g)) / Math.sqrt(v(e) / e.length + v(g) / g.length) : null;
  return { easing: { n: e.length, mean: e.length ? mean(e) : null, up: e.filter((x) => x > 0).length }, tightening: { n: g.length, mean: g.length ? mean(g) : null, up: g.filter((x) => x > 0).length }, t };
}

// What the index did after each turn: from the month-end before it took
// effect, three and twelve months on, and so far for one under way.
export function afterTurns(series: MonthRet[], turns: Turn[]): Array<{ turn: Turn; m3: number | null; m12: number | null; soFar: number | null }> {
  const level = new Map<string, number>();
  let lv = 100;
  if (series.length) level.set(prevMonth(series[0].month), lv);
  for (const r of series) {
    lv *= 1 + r.ret / 100;
    level.set(r.month, lv);
  }
  const last = series[series.length - 1]?.month;
  return turns
    .filter((t) => level.has(prevMonth(t.date.slice(0, 7))))
    .map((t, i, all) => {
      const base = prevMonth(t.date.slice(0, 7));
      const b = level.get(base)!;
      const at = (n: number) => {
        const m = addMonths(base, n);
        return level.has(m) ? (level.get(m)! / b - 1) * 100 : null;
      };
      const current = i === all.length - 1 && t === turns[turns.length - 1];
      return { turn: t, m3: at(3), m12: at(12), soFar: current && last ? (level.get(last)! / b - 1) * 100 : null };
    });
}
