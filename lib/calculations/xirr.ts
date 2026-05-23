export type CashFlow = { date: Date; amount: number };

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const MAX_ITER = 100;
const TOL = 1e-7;

function npv(rate: number, flows: CashFlow[], t0: number): number {
  let sum = 0;
  for (const f of flows) {
    const t = (f.date.getTime() - t0) / MS_PER_YEAR;
    sum += f.amount / Math.pow(1 + rate, t);
  }
  return sum;
}

function dnpv(rate: number, flows: CashFlow[], t0: number): number {
  let sum = 0;
  for (const f of flows) {
    const t = (f.date.getTime() - t0) / MS_PER_YEAR;
    sum += (-t * f.amount) / Math.pow(1 + rate, t + 1);
  }
  return sum;
}

export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const hasPos = sorted.some((f) => f.amount > 0);
  const hasNeg = sorted.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = sorted[0].date.getTime();
  let r = guess;
  for (let i = 0; i < MAX_ITER; i++) {
    const f = npv(r, sorted, t0);
    if (!Number.isFinite(f)) return null;
    if (Math.abs(f) < TOL) return r;
    const d = dnpv(r, sorted, t0);
    if (!Number.isFinite(d) || d === 0) return null;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -1) {
      r = r / 2;
      continue;
    }
    if (Math.abs(next - r) < TOL) return next;
    r = next;
  }
  return null;
}

export function cagr(start: number, end: number, years: number): number | null {
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}
