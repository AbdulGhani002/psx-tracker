// The macro study, computed once for both the printed report (macro-study.ts)
// and the model the server reads (macro-final.ts): how each sector moves with
// the factors, the timing test, and the monthly history "times like now"
// compares against.

import { macroState, MACRO_NAMES, logChange, valueOn, monthsBack } from "../lib/macro/series";
import { STOCK_NAMES } from "../lib/macro/panel";
import { sectorSensitivities, timingWalk, analogs, type TimingMonth, type MonthState, type Sensitivity, type TimingRecord } from "../lib/macro/analytics";
import type { AnalogMonth } from "../lib/macro/artifact";
import type { Loaded } from "./macro-inputs";

export const FACTOR_LABELS = ["oil", "rupee", "gold", "policy", "US stocks"];
// "Times like now" compares rates, their direction, inflation, the real rate,
// a year of oil, the rupee, gold and US stocks, and the market's own fall and
// year.
export const ANALOG = ["policy", "policyChg12", "cpi", "realRate", "oil12", "pkr12", "gold12", "spx12", "mktDd12", "mktRet12"] as const;
const PICK = ANALOG.map((n) => MACRO_NAMES.indexOf(n));

export type Study = {
  sensitivities: Sensitivity[];
  timing: { trend: TimingRecord; macro: TimingRecord; analogs: TimingRecord; always: TimingRecord };
  analogHistory: AnalogMonth[];
};

export function runStudy(L: Loaded, fromYear = 2008): Study {
  const { inputs, market, rows } = L;
  const months = [...new Set(rows.map((r) => r.date))].sort();
  const rel1 = STOCK_NAMES.indexOf("rel1");

  // 1. Sensitivities: each sector's month against the market, on the factors'
  // moves over the same month.
  const factorsOf = (date: string): number[] => [
    logChange(inputs.oil, date, 1, true) ?? NaN,
    logChange(inputs.usdpkr, date, 1) ?? NaN,
    logChange(inputs.gold, date, 1, true) ?? NaN,
    (() => {
      const a = valueOn(inputs.policy, date), b = valueOn(inputs.policy, monthsBack(date, 1));
      return a != null && b != null ? a - b : NaN;
    })(),
    logChange(inputs.spx, date, 1, true) ?? NaN,
  ];
  const factors = new Map(months.map((d) => [d, factorsOf(d)]));
  const byMonth = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const r of rows) {
    if (!r.sector || !Number.isFinite(r.x[rel1])) continue;
    const m = byMonth.get(r.date) ?? byMonth.set(r.date, new Map()).get(r.date)!;
    const s = m.get(r.sector) ?? m.set(r.sector, { sum: 0, n: 0 }).get(r.sector)!;
    s.sum += r.x[rel1];
    s.n++;
  }
  const monthly = months.map((date) => ({ date, sectors: new Map([...(byMonth.get(date) ?? new Map())].map(([k, v]) => [k, { rel: v.sum / v.n, n: v.n }])) }));
  const sensitivities = sectorSensitivities(monthly, factors, 60).filter((s) => s.names >= 2.5);

  // 2. Timing: the market's three months against T-bills (the policy rate).
  const at = new Map(market.map((b, i) => [b.date, i]));
  const fwd = (date: string, n: number) => {
    const i = at.get(date);
    return i != null && i + n < market.length ? Math.log(market[i + n].close / market[i].close) : null;
  };
  const timing: TimingMonth[] = months.map((date) => {
    const stock = fwd(date, 63);
    const cash = ((valueOn(inputs.policy, date) ?? 10) / 100) * (63 / 252);
    return { date, x: macroState(date, inputs).map((v) => (v == null ? NaN : v)), stock, cash, excess: stock == null ? null : stock - cash };
  });
  const byDate = new Map(timing.map((t) => [t.date, t]));
  const state = (t: TimingMonth): MonthState => ({ date: t.date, x: PICK.map((j) => t.x[j]) });
  const macro = timingWalk(timing, fromYear, 50).rec;
  const always = timingWalk(timing, fromYear, 50, () => 1).rec;
  const trend = timingWalk(timing, fromYear, 50, (m) => {
    const i = at.get(m.date) ?? -1;
    if (i < 200) return 1;
    let s = 0;
    for (let k = i - 199; k <= i; k++) s += market[k].close;
    return market[i].close > s / 200 ? 1 : -1;
  }).rec;
  const analogTiming = timingWalk(timing, fromYear, 50, (m, train) => {
    const near = analogs(train.map(state), state(m), 8, 3);
    const ex = near.map((a) => byDate.get(a.date)?.excess).filter((v): v is number => v != null);
    return ex.length ? ex.reduce((s, v) => s + v, 0) / ex.length : 0;
  }).rec;

  // 3. The history "times like now" reads: each month's state, what the
  // market did next, the sectors that did best and worst over six months, and
  // the universe's median dividend yield where the record has it.
  const dyCol = STOCK_NAMES.indexOf("dy");
  const analogHistory: AnalogMonth[] = timing.map((t) => {
    const here = rows.filter((r) => r.date === t.date);
    const bySec = new Map<string, number[]>();
    for (const r of here) if (r.sector && r.fwd6 != null) (bySec.get(r.sector) ?? bySec.set(r.sector, []).get(r.sector)!).push(r.fwd6);
    const ranked = [...bySec].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length] as [string, number]).sort((a, b) => b[1] - a[1]);
    const dys = here.map((r) => r.x[dyCol]).filter(Number.isFinite).sort((a, b) => a - b);
    const r4 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4);
    return {
      date: t.date,
      x: PICK.map((j) => r4(t.x[j]) ?? NaN),
      mkt3: r4(fwd(t.date, 63)),
      mkt6: r4(fwd(t.date, 126)),
      mkt12: r4(fwd(t.date, 252)),
      best: ranked.slice(0, 3).map(([k, v]) => [k, r4(v)!]),
      worst: ranked.slice(-3).reverse().map(([k, v]) => [k, r4(v)!]),
      dy: dys.length ? r4(dys[Math.floor(dys.length / 2)]) : null,
    };
  });
  return { sensitivities, timing: { trend, macro, analogs: analogTiming, always }, analogHistory };
}
