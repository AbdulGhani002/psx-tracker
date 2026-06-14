// Portfolio risk analysis: concentration, correlation, and scenario stress.
// Separate from risk.ts (which does vol / Sharpe / beta on the time series).

export type Position = { symbol: string; sector: string; marketValue: number };

export type ConcentrationResult = {
  totalValue: number;
  positions: { symbol: string; sector: string; value: number; pct: number; overCap: boolean }[];
  sectors: { sector: string; value: number; pct: number }[];
  top1Pct: number;
  top3Pct: number;
  top5Pct: number;
  hhi: number; // Herfindahl index, 0..1 (sum of squared weights)
  effectiveHoldings: number; // 1 / HHI — "how many equal positions this is like"
  verdict: "well diversified" | "moderately concentrated" | "highly concentrated";
};

export function analyzeConcentration(positions: Position[], capPct: number): ConcentrationResult {
  const live = positions.filter((p) => p.marketValue > 0);
  const totalValue = live.reduce((s, p) => s + p.marketValue, 0);
  const rows = live
    .map((p) => ({ symbol: p.symbol, sector: p.sector || "Unknown", value: p.marketValue, pct: totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0, overCap: false }))
    .sort((a, b) => b.value - a.value);
  for (const r of rows) r.overCap = r.pct > capPct;

  const sectorMap = new Map<string, number>();
  for (const r of rows) sectorMap.set(r.sector, (sectorMap.get(r.sector) ?? 0) + r.value);
  const sectors = [...sectorMap.entries()]
    .map(([sector, value]) => ({ sector, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const cumPct = (n: number) => rows.slice(0, n).reduce((s, r) => s + r.pct, 0);
  const hhi = rows.reduce((s, r) => s + Math.pow(r.pct / 100, 2), 0);
  const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;
  const verdict = hhi >= 0.25 ? "highly concentrated" : hhi >= 0.15 ? "moderately concentrated" : "well diversified";

  return { totalValue, positions: rows, sectors, top1Pct: cumPct(1), top3Pct: cumPct(3), top5Pct: cumPct(5), hhi, effectiveHoldings, verdict };
}

// --- Correlation --------------------------------------------------------------
// Pearson correlation of daily returns. Series are date->close maps aligned on
// common trading days.
export type PriceSeries = { symbol: string; points: { date: string; close: number }[] };

function dailyReturns(points: { date: string; close: number }[]): Map<string, number> {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close;
    if (prev > 0) out.set(sorted[i].date, sorted[i].close / prev - 1);
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : null;
}

export type CorrelationResult = {
  symbols: string[];
  matrix: (number | null)[][];
  avgPairwise: number | null;
  mostCorrelated: { a: string; b: string; r: number } | null;
};

export function analyzeCorrelation(series: PriceSeries[]): CorrelationResult {
  const valid = series.filter((s) => s.points.length >= 4);
  const symbols = valid.map((s) => s.symbol);
  const rets = valid.map((s) => dailyReturns(s.points));
  const matrix: (number | null)[][] = symbols.map(() => symbols.map(() => null));
  const pairs: { a: string; b: string; r: number }[] = [];

  for (let i = 0; i < symbols.length; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < symbols.length; j++) {
      const common = [...rets[i].keys()].filter((d) => rets[j].has(d)).sort();
      const a = common.map((d) => rets[i].get(d) as number);
      const b = common.map((d) => rets[j].get(d) as number);
      const r = pearson(a, b);
      matrix[i][j] = r;
      matrix[j][i] = r;
      if (r != null) pairs.push({ a: symbols[i], b: symbols[j], r });
    }
  }

  const avgPairwise = pairs.length ? pairs.reduce((s, p) => s + p.r, 0) / pairs.length : null;
  const mostCorrelated = pairs.length ? pairs.reduce((m, p) => (p.r > m.r ? p : m)) : null;
  return { symbols, matrix, avgPairwise, mostCorrelated };
}

// --- Scenario stress ----------------------------------------------------------
export type StressInput = {
  equity: number;
  funds: number;
  savings: number;
  cash: number;
  marketDropPct: number; // applied to equity + funds (market-linked)
  safeRatePct: number; // for the income impact
};

export type StressResult = {
  baseNetWorth: number;
  stressedNetWorth: number;
  lossPkr: number;
  lossPct: number;
  safeIncomeBefore: number; // monthly
  safeIncomeAfter: number; // monthly
};

export function stressTest(i: StressInput): StressResult {
  const base = i.equity + i.funds + i.savings + i.cash;
  const drop = i.marketDropPct / 100;
  const stressed = i.equity * (1 - drop) + i.funds * (1 - drop) + i.savings + i.cash;
  const loss = base - stressed;
  const safeBefore = (base * (i.safeRatePct / 100)) / 12;
  const safeAfter = (stressed * (i.safeRatePct / 100)) / 12;
  return {
    baseNetWorth: base,
    stressedNetWorth: stressed,
    lossPkr: loss,
    lossPct: base > 0 ? (loss / base) * 100 : 0,
    safeIncomeBefore: safeBefore,
    safeIncomeAfter: safeAfter,
  };
}
