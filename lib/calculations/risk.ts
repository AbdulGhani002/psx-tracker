// Risk metrics from a daily index series (indexed to 100). Trading-day basis.

const TRADING_DAYS = 252;

function dailyReturns(series: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) r.push(series[i] / series[i - 1] - 1);
  }
  return r;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function maxDrawdown(series: number[]): { maxDD: number; peakIdx: number; troughIdx: number } {
  let peak = series[0] ?? 0;
  let peakIdx = 0;
  let maxDD = 0;
  let ddPeak = 0;
  let ddTrough = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] > peak) {
      peak = series[i];
      peakIdx = i;
    }
    const dd = peak > 0 ? series[i] / peak - 1 : 0;
    if (dd < maxDD) {
      maxDD = dd;
      ddPeak = peakIdx;
      ddTrough = i;
    }
  }
  return { maxDD, peakIdx: ddPeak, troughIdx: ddTrough };
}

export type RiskMetrics = {
  days: number;
  annualReturn: number | null;
  annualVol: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  alpha: number | null;
};

export function computeRisk({
  portfolio,
  benchmark,
  riskFreeAnnual,
}: {
  portfolio: number[]; // daily index
  benchmark: number[]; // KSE daily index, same length
  riskFreeAnnual: number; // e.g. 0.105
}): RiskMetrics {
  const pr = dailyReturns(portfolio);
  const days = pr.length;
  if (days < 5) {
    return { days, annualReturn: null, annualVol: null, sharpe: null, sortino: null, maxDrawdown: null, beta: null, alpha: null };
  }

  const annualReturn = Math.pow(portfolio[portfolio.length - 1] / portfolio[0], TRADING_DAYS / days) - 1;
  const annualVol = stdev(pr) * Math.sqrt(TRADING_DAYS);
  const downside = pr.filter((x) => x < 0);
  const downsideDev = stdev(downside.length ? downside : [0]) * Math.sqrt(TRADING_DAYS);
  const excess = annualReturn - riskFreeAnnual;
  const sharpe = annualVol > 0 ? excess / annualVol : null;
  const sortino = downsideDev > 0 ? excess / downsideDev : null;
  const { maxDD } = maxDrawdown(portfolio);

  // Beta/alpha vs benchmark (align return arrays).
  const br = dailyReturns(benchmark);
  let beta: number | null = null;
  let alpha: number | null = null;
  const n = Math.min(pr.length, br.length);
  if (n >= 5) {
    const p = pr.slice(pr.length - n);
    const b = br.slice(br.length - n);
    const mp = mean(p);
    const mb = mean(b);
    let cov = 0;
    let varb = 0;
    for (let i = 0; i < n; i++) {
      cov += (p[i] - mp) * (b[i] - mb);
      varb += (b[i] - mb) ** 2;
    }
    if (varb > 0) {
      beta = cov / varb;
      const annBench = Math.pow(benchmark[benchmark.length - 1] / benchmark[0], TRADING_DAYS / br.length) - 1;
      // CAPM alpha
      alpha = annualReturn - (riskFreeAnnual + beta * (annBench - riskFreeAnnual));
    }
  }

  return {
    days,
    annualReturn,
    annualVol,
    sharpe,
    sortino,
    maxDrawdown: maxDD,
    beta,
    alpha,
  };
}
