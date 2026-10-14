// Whether a share's company or the economy has changed a lot, for the price
// rules: the rules hold only while they have not. Plain facts from the data
// kept, so Telegram can say what moved. Pure, so scripts/test-rules.ts runs it.
//   - Profit: the last year's EPS against the year before, a lot when it
//     moved more than listed companies' usual yearly change (the median,
//     worked out from every company's record kept), or crossed into a loss
//     or out of one.
//   - Dividend: the last full year's against the year before, a lot when it
//     was cut by more than half or stopped.
//   - Policy rate and rupee: since the shares held now were bought, a lot
//     past the limits set with the rules.

export type ProfitCheck = { year: number; eps: number; prevEps: number; changePct: number | null; usualPct: number | null; alot: boolean };
export type DividendCheck = { label: string; dps: number; prevLabel: string; prevDps: number; alot: boolean };
export type MoveCheck = { from: number; to: number; change: number; limit: number; alot: boolean };
export type Checks = { profit: ProfitCheck | null; dividend: DividendCheck | null; rate: MoveCheck | null; rupee: MoveCheck | null; alot: boolean };

type Annual = { fiscalYear: number; eps: number | null };

const yearly = (annual: Annual[]) =>
  annual
    .filter((a) => a.eps != null && Number.isFinite(a.eps))
    .sort((a, b) => b.fiscalYear - a.fiscalYear) as Array<{ fiscalYear: number; eps: number }>;

// The median size of a yearly EPS change across listed companies, %.
export function usualEpsMove(all: Annual[][]): number | null {
  const moves: number[] = [];
  for (const annual of all) {
    const ys = yearly(annual);
    for (let k = 0; k + 1 < ys.length; k++) {
      if (ys[k].fiscalYear - ys[k + 1].fiscalYear !== 1 || !(ys[k + 1].eps > 0)) continue;
      moves.push(Math.abs(ys[k].eps / ys[k + 1].eps - 1) * 100);
    }
  }
  if (moves.length < 20) return null;
  moves.sort((a, b) => a - b);
  const mid = moves.length >> 1;
  return moves.length % 2 ? moves[mid] : (moves[mid - 1] + moves[mid]) / 2;
}

export function profitCheck(annual: Annual[], usualPct: number | null): ProfitCheck | null {
  const ys = yearly(annual);
  if (ys.length < 2 || ys[0].fiscalYear - ys[1].fiscalYear !== 1) return null;
  const [a, b] = ys;
  const changePct = b.eps > 0 ? (a.eps / b.eps - 1) * 100 : null;
  const crossed = a.eps > 0 !== b.eps > 0;
  const alot = crossed || (changePct != null && usualPct != null && Math.abs(changePct) > usualPct);
  return { year: a.fiscalYear, eps: a.eps, prevEps: b.eps, changePct, usualPct, alot };
}

export function dividendCheck(byYear: Array<{ fyEndYear: number; label: string; dps: number; complete: boolean }>): DividendCheck | null {
  const full = byYear.filter((y) => y.complete).sort((a, b) => b.fyEndYear - a.fyEndYear);
  if (full.length < 2 || !(full[1].dps > 0)) return null;
  const [a, b] = full;
  return { label: a.label, dps: a.dps, prevLabel: b.label, prevDps: b.dps, alot: a.dps < b.dps / 2 };
}

export function moveCheck(from: number | null, to: number | null, limit: number, asPct: boolean): MoveCheck | null {
  if (from == null || to == null || !(from > 0) || !(to > 0)) return null;
  const change = asPct ? (to / from - 1) * 100 : to - from;
  return { from, to, change, limit, alot: Math.abs(change) >= limit };
}

export function combine(parts: Omit<Checks, "alot">): Checks {
  return { ...parts, alot: [parts.profit, parts.dividend, parts.rate, parts.rupee].some((c) => c?.alot) };
}

const sign = (v: number, d = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const two = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

// One line: what moved a lot first, or that everything is steady.
export function checksLine(c: Checks): string {
  const big: string[] = [];
  const calm: string[] = [];
  if (c.profit) {
    const p = c.profit;
    const what = p.changePct != null ? `profit ${sign(p.changePct)}% (EPS ${two(p.eps)} vs ${two(p.prevEps)})` : `profit ${p.eps > 0 ? "back from a loss" : "a loss"} (EPS ${two(p.eps)} vs ${two(p.prevEps)})`;
    (p.alot ? big : calm).push(p.alot && p.usualPct != null && p.changePct != null ? `${what}, more than the usual ${p.usualPct.toFixed(0)}%` : what);
  }
  if (c.dividend) (c.dividend.alot ? big : calm).push(c.dividend.alot ? `dividend cut to ${two(c.dividend.dps)} from ${two(c.dividend.prevDps)}` : "dividend kept");
  if (c.rate) (c.rate.alot ? big : calm).push(`policy rate ${c.rate.from.toFixed(1)}% → ${c.rate.to.toFixed(1)}%`);
  if (c.rupee) (c.rupee.alot ? big : calm).push(`rupee ${c.rupee.change >= 0 ? "weaker" : "stronger"} by ${Math.abs(c.rupee.change).toFixed(1)}%`);
  if (big.length) return `⚠ Check first: ${big.join("; ")}.`;
  return calm.length ? `✓ Steady: ${calm.join(", ")}.` : "";
}

// Each check as a label, whether it is steady, and the facts behind it, for
// the rules page.
export function checkFacts(c: Checks): Array<{ label: string; ok: boolean; text: string }> {
  const out: Array<{ label: string; ok: boolean; text: string }> = [];
  if (c.profit) {
    const p = c.profit;
    out.push({ label: "Profit", ok: !p.alot, text: `EPS ${two(p.eps)} in ${p.year} against ${two(p.prevEps)}${p.changePct != null ? `: ${sign(p.changePct)}%` : ""}${p.usualPct != null ? `. Companies' usual yearly move: ${p.usualPct.toFixed(0)}%` : ""}` });
  }
  if (c.dividend) out.push({ label: "Dividend", ok: !c.dividend.alot, text: `${c.dividend.label} Rs ${two(c.dividend.dps)} a share against ${c.dividend.prevLabel} Rs ${two(c.dividend.prevDps)}` });
  if (c.rate) out.push({ label: "Rates", ok: !c.rate.alot, text: `Policy rate ${c.rate.from.toFixed(1)}% when you bought, ${c.rate.to.toFixed(1)}% now (a lot: ±${c.rate.limit} points)` });
  if (c.rupee) out.push({ label: "Rupee", ok: !c.rupee.alot, text: `Rs ${c.rupee.from.toFixed(2)} a dollar when you bought, Rs ${c.rupee.to.toFixed(2)} now: ${sign(c.rupee.change, 1)}% (a lot: ±${c.rupee.limit}%)` });
  return out;
}
