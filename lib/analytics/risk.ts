// Risk on the book as it stands: what the holdings you own today would have
// done, priced through the last year of closes. Volatility, beta and
// correlations per name, value at risk and expected shortfall for the whole
// book, how concentrated it is, how long each position would take to sell,
// and what the book does when the index is shocked. All from the bars cache.

import "server-only";
import { cache } from "react";
import { getPortfolioSummary } from "@/lib/data";
import { eodBarsCached } from "@/lib/timeseries/eod-cache";

export type NameRisk = {
  symbol: string;
  name: string;
  sector: string;
  weightPct: number;
  value: number;
  vol1yPct: number;
  vol60Pct: number;
  beta: number | null;
  corrToIndex: number | null;
  maxDrawdown1yPct: number;
  ret60Pct: number; // momentum, relative to the index
  advValue20: number; // average traded value, 20 sessions
  daysToExit: number | null; // at a fifth of the daily volume
  riskContributionPct: number; // share of portfolio variance
  betaContribution: number; // weight x beta
};

export type Scenario = { name: string; indexPct: number; portfolioPct: number; portfolioRs: number; from?: string; to?: string; note: string };

export type RiskView = {
  asOf: string;
  value: number;
  names: NameRisk[];
  portfolio: {
    vol1yPct: number;
    beta: number | null;
    var95Rs: number; // one session, historical
    var99Rs: number;
    es95Rs: number;
    var95_20dRs: number; // twenty sessions, historical overlapping windows
    maxDrawdown1yPct: number;
    worstDay: { date: string; pct: number };
    bestDay: { date: string; pct: number };
    diversificationRatio: number | null; // weighted average vol / portfolio vol
    hhi: number;
    effectiveNames: number;
    top3WeightPct: number;
    sectors: Array<{ sector: string; weightPct: number }>;
  };
  correlations: { symbols: string[]; matrix: number[][] };
  scenarios: Scenario[];
  sessions: number;
};

const ln = Math.log;

function mean(v: number[]) {
  return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
}
function std(v: number[]) {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
}
function corr(a: number[], b: number[]) {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function maxDrawdown(closes: number[]) {
  let peak = -Infinity, dd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    dd = Math.min(dd, c / peak - 1);
  }
  return dd;
}

async function _getRisk(): Promise<RiskView | null> {
  const summary = await getPortfolioSummary();
  const held = summary.positions.filter((p) => p.shares > 0 && p.priceKnown && p.marketValue > 0);
  if (held.length === 0) return null;
  const symbols = held.map((p) => p.symbol);
  const bars = await eodBarsCached(["KSE100", ...symbols]);
  const kse = bars.get("KSE100") ?? [];
  if (kse.length < 60) return null;
  // The common calendar: the KSE-100's last 250 sessions.
  const days = kse.slice(-251).map((b) => b.date);
  const kseClose = new Map(kse.map((b) => [b.date, b.close]));
  const rets = (closes: Map<string, number>) => {
    const out: number[] = [];
    let prev: number | null = null;
    for (const d of days) {
      const c = closes.get(d) ?? prev;
      if (c == null) {
        out.push(0);
        continue;
      }
      out.push(prev != null && prev > 0 ? ln(c / prev) : 0);
      prev = c;
    }
    return out.slice(1);
  };
  const idxR = rets(kseClose);
  const total = held.reduce((s, p) => s + p.marketValue, 0);
  const weights = held.map((p) => p.marketValue / total);
  const series: number[][] = [];
  const names: NameRisk[] = [];

  for (const [i, p] of held.entries()) {
    const b = bars.get(p.symbol) ?? [];
    const closes = new Map(b.map((x) => [x.date, x.close]));
    const r = rets(closes);
    series.push(r);
    const r60 = r.slice(-60);
    const beta = idxR.length > 40 ? (() => { const c = corr(r, idxR); const s = std(r), si = std(idxR); return si > 0 ? (c * s) / si : null; })() : null;
    const last250 = b.slice(-250).map((x) => x.close);
    const val20 = b.slice(-20).reduce((s, x) => s + x.close * x.volume, 0) / Math.max(1, Math.min(20, b.length));
    const vol20 = b.slice(-20).reduce((s, x) => s + x.volume, 0) / Math.max(1, Math.min(20, b.length));
    const n = b.length;
    const ret60 = n > 60 && kse.length > 60 ? (b[n - 1].close / b[n - 61].close - kse[kse.length - 1].close / kse[kse.length - 61].close) * 100 : 0;
    names.push({
      symbol: p.symbol,
      name: p.name,
      sector: p.sector,
      weightPct: weights[i] * 100,
      value: p.marketValue,
      vol1yPct: std(r) * Math.sqrt(252) * 100,
      vol60Pct: std(r60) * Math.sqrt(252) * 100,
      beta,
      corrToIndex: idxR.length > 40 ? corr(r, idxR) : null,
      maxDrawdown1yPct: maxDrawdown(last250) * 100,
      ret60Pct: ret60,
      advValue20: val20,
      daysToExit: vol20 > 0 ? p.shares / (vol20 * 0.2) : null,
      riskContributionPct: 0,
      betaContribution: (beta ?? 0) * weights[i],
    });
  }

  // The book's own daily returns at today's weights.
  const T = idxR.length;
  const portR: number[] = new Array(T).fill(0);
  for (let t = 0; t < T; t++) for (let i = 0; i < held.length; i++) portR[t] += weights[i] * (series[i][t] ?? 0);
  const pVol = std(portR);
  // Risk contribution: w_i x cov(r_i, r_p) / var(r_p).
  if (pVol > 0) {
    const mp = mean(portR);
    for (let i = 0; i < held.length; i++) {
      const mi = mean(series[i]);
      let cov = 0;
      for (let t = 0; t < T; t++) cov += (series[i][t] - mi) * (portR[t] - mp);
      cov /= Math.max(1, T - 1);
      names[i].riskContributionPct = ((weights[i] * cov) / (pVol * pVol)) * 100;
    }
  }
  const sorted = [...portR].sort((a, b) => a - b);
  const var95 = -quantile(sorted, 0.05), var99 = -quantile(sorted, 0.01);
  const tail = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)));
  const es95 = -mean(tail);
  const r20: number[] = [];
  for (let t = 20; t <= T; t++) r20.push(portR.slice(t - 20, t).reduce((s, x) => s + x, 0));
  const var95_20 = -quantile([...r20].sort((a, b) => a - b), 0.05);
  let worst = { date: "", pct: 0 }, best = { date: "", pct: 0 };
  portR.forEach((r, t) => {
    if (r < worst.pct) worst = { date: days[t + 1], pct: r * 100 };
    if (r > best.pct) best = { date: days[t + 1], pct: r * 100 };
  });
  const cum: number[] = [];
  let level = 1;
  for (const r of portR) {
    level *= Math.exp(r);
    cum.push(level);
  }
  const pBeta = names.every((n) => n.beta != null) ? names.reduce((s, n) => s + n.betaContribution, 0) : null;
  const wAvgVol = names.reduce((s, n, i) => s + weights[i] * n.vol1yPct, 0);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const sectorMap = new Map<string, number>();
  for (const [i, p] of held.entries()) sectorMap.set(p.sector, (sectorMap.get(p.sector) ?? 0) + weights[i] * 100);

  // Correlations between the names.
  const matrix = series.map((a) => series.map((b) => corr(a, b)));

  // Stress: index shocks through beta, and the worst windows the index
  // actually printed in the history at hand.
  const scenarios: Scenario[] = [];
  const bookBeta = pBeta ?? 1;
  for (const shock of [-0.05, -0.1, -0.2, 0.1]) {
    scenarios.push({ name: `KSE-100 ${shock > 0 ? "+" : ""}${Math.round(shock * 100)}%`, indexPct: shock * 100, portfolioPct: bookBeta * shock * 100, portfolioRs: total * bookBeta * shock, note: `Through the book's beta of ${bookBeta.toFixed(2)}` });
  }
  const closes = kse.map((b) => b.close);
  const worstWindow = (n: number) => {
    let w = 0, from = "", to = "";
    for (let i = n; i < closes.length; i++) {
      const r = closes[i] / closes[i - n] - 1;
      if (r < w) {
        w = r;
        from = kse[i - n].date;
        to = kse[i].date;
      }
    }
    return { w, from, to };
  };
  for (const [label, n] of [["worst day", 1], ["worst week", 5], ["worst month", 20], ["worst quarter", 60]] as Array<[string, number]>) {
    const ww = worstWindow(n);
    if (ww.w < 0) scenarios.push({ name: `The index's ${label} in this history`, indexPct: ww.w * 100, portfolioPct: bookBeta * ww.w * 100, portfolioRs: total * bookBeta * ww.w, from: ww.from, to: ww.to, note: `${ww.from} to ${ww.to}, through beta` });
  }
  // What this exact book did on its own worst window.
  let wb = 0, wbFrom = "", wbTo = "";
  for (let t = 20; t <= T; t++) {
    const r = Math.exp(portR.slice(t - 20, t).reduce((s, x) => s + x, 0)) - 1;
    if (r < wb) {
      wb = r;
      wbFrom = days[t - 19];
      wbTo = days[t];
    }
  }
  if (wb < 0) scenarios.push({ name: "This book's own worst month, last year", indexPct: 0, portfolioPct: wb * 100, portfolioRs: total * wb, from: wbFrom, to: wbTo, note: "Today's weights through last year's closes" });

  return {
    asOf: days[days.length - 1],
    value: total,
    names: names.sort((a, b) => b.weightPct - a.weightPct),
    portfolio: {
      vol1yPct: pVol * Math.sqrt(252) * 100,
      beta: pBeta,
      var95Rs: var95 * total,
      var99Rs: var99 * total,
      es95Rs: es95 * total,
      var95_20dRs: var95_20 * total,
      maxDrawdown1yPct: maxDrawdown(cum) * 100,
      worstDay: worst,
      bestDay: best,
      diversificationRatio: pVol > 0 ? wAvgVol / (pVol * Math.sqrt(252) * 100) : null,
      hhi,
      effectiveNames: hhi > 0 ? 1 / hhi : 0,
      top3WeightPct: [...weights].sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0) * 100,
      sectors: [...sectorMap.entries()].map(([sector, weightPct]) => ({ sector, weightPct })).sort((a, b) => b.weightPct - a.weightPct),
    },
    correlations: { symbols: held.map((p) => p.symbol), matrix },
    scenarios,
    sessions: T,
  };
}

export const getRisk = cache(_getRisk);
