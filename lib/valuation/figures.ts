// What the home machine's model read from a results filing, page by page
// (lib/valuation/read-filing.ts), settled into one set of figures. The model
// copies; this decides. It copies each statement's title and the unit line as
// printed, and the basis and the scale are worked out here from those; the
// profit is accepted only where profit over the shares gives the EPS printed
// beside it, which settles the scale too. The company's own (unconsolidated)
// statements are preferred, as the exchange's yearly figures are. Pure, so
// scripts/test-valuation.ts runs it.

import type { ResultFigures } from "@/lib/prices/results";
import { periodOf } from "@/lib/prices/results";

export type PageRead = {
  page: number;
  source: "text" | "image";
  title: string;
  unitText: string;
  statement: "profit or loss" | "financial position" | "other";
  periodEnd: string;
  periodMonths: number;
  netProfit: number | null;
  netProfitPrior: number | null;
  eps: number | null;
  epsPrior: number | null;
  totalAssets?: number | null;
  totalEquity: number | null;
  revaluationSurplus?: number | null;
  shareCapital: number | null;
};

export type Settled = Pick<ResultFigures, "period" | "periodEnd" | "eps" | "epsPrior" | "profit" | "equity" | "revaluation" | "basis"> & { checks: string[] };

export const basisOf = (title: string): "unconsolidated" | "consolidated" | null =>
  /un-?\s*consolidated|stand-?\s*alone|separate/i.test(title) ? "unconsolidated" : /consolidated/i.test(title) ? "consolidated" : null;

export const scaleOf = (unit: string): number | null =>
  /'?\s*000|thousand/i.test(unit) ? 1e3 : /million|\bmn\b/i.test(unit) ? 1e6 : /rupee|\brs\b|pkr/i.test(unit) ? 1 : null;

const PERIOD: Record<number, ResultFigures["period"]> = { 12: "year", 9: "nine months", 6: "half year", 3: "quarter" };
const okDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d));
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.abs(b) * tol;

// The company's own statement first, then one whose title says neither.
function pick(pages: PageRead[], kind: PageRead["statement"], has: (p: PageRead) => boolean): PageRead | null {
  const c = pages.filter((p) => p.statement === kind && has(p));
  return c.find((p) => basisOf(p.title) === "unconsolidated") ?? c.find((p) => basisOf(p.title) == null) ?? c[0] ?? null;
}

export type SettleContext = { sharesNow: number | null; lastEps: number | null; lastBvps: number | null; lastEquity?: number | null; lastEquityAt?: string | null };

export function settleFigures(pages: PageRead[], ctx: SettleContext): Settled {
  const checks: string[] = [];
  const out: Settled = { period: null, periodEnd: null, eps: null, epsPrior: null, profit: null, equity: null, revaluation: null, basis: null, checks };
  const pl = pick(pages, "profit or loss", (p) => p.eps != null || p.netProfit != null);
  let scale: number | null = null;
  if (pl) {
    out.basis = basisOf(pl.title);
    const fromTitle = periodOf(pl.title);
    out.periodEnd = okDate(pl.periodEnd) ? pl.periodEnd : fromTitle.periodEnd;
    out.period = PERIOD[pl.periodMonths] ?? fromTitle.period;
    if (out.basis === "consolidated") checks.push("Only group (consolidated) figures were found.");
    // The scale that makes profit over today's shares the printed EPS.
    const shares = ctx.sharesNow;
    if (pl.eps != null && pl.netProfit != null && shares) {
      const tries = [...new Set([scaleOf(pl.unitText), 1e3, 1, 1e6].filter((x): x is number => x != null))];
      scale = tries.find((s) => close((pl.netProfit! * s) / shares, pl.eps!, 0.15)) ?? null;
      if (scale != null) {
        out.eps = pl.eps;
        out.epsPrior = pl.epsPrior;
        out.profit = pl.netProfit * scale;
      } else checks.push(`EPS ${pl.eps} does not match profit ${pl.netProfit} over ${shares.toLocaleString("en-US")} shares.`);
    }
    // Unchecked by the profit, an EPS is kept when it is near the last year's
    // (a fifth to five times).
    if (out.eps == null && pl.eps != null && scale == null) {
      const near = ctx.lastEps != null && ctx.lastEps > 0 && pl.eps > 0 ? pl.eps / ctx.lastEps >= 0.2 && pl.eps / ctx.lastEps <= 5 : false;
      if (near) {
        out.eps = pl.eps;
        out.epsPrior = pl.epsPrior;
        checks.push("EPS kept without a profit to check it against.");
      } else checks.push(pl.netProfit != null && shares ? `EPS ${pl.eps} left out.` : `EPS ${pl.eps} left out: no profit to check it against.`);
    }
    if (!pl.unitText && scale == null) checks.push("No unit printed on the profit page.");
  } else checks.push("No profit or loss statement found.");

  // Book value: the same basis as the profit where there is one; never a
  // figure equal to total assets (that is the "total equity and liabilities"
  // line); the scale the profit settled, else the printed unit; kept when the
  // book a share is within a third and three times the last one known, and
  // within 30% of the server's own when that is under nine months older.
  const sameAsAssets = (p: PageRead) => p.totalAssets != null && p.totalEquity != null && Math.abs(p.totalEquity - p.totalAssets) <= Math.abs(p.totalAssets) * 0.001;
  const fps = pages.filter((p) => !out.basis || basisOf(p.title) === out.basis || basisOf(p.title) == null);
  if (fps.some((p) => p.statement === "financial position" && sameAsAssets(p))) checks.push("A total-assets line was read as equity: left out.");
  const fp = pick(fps.filter((p) => !sameAsAssets(p)), "financial position", (p) => p.totalEquity != null && p.totalEquity > 0);
  if (fp && ctx.sharesNow) {
    const s = (fp.unitText && pl?.unitText && fp.unitText.replace(/\s/g, "") === pl.unitText.replace(/\s/g, "") ? scale : null) ?? scaleOf(fp.unitText) ?? scale;
    const tries = [...new Set([s, 1e3, 1, 1e6].filter((x): x is number => x != null))];
    const fits = (x: number) => {
      const b = (fp.totalEquity! * x) / ctx.sharesNow!;
      return ctx.lastBvps != null && ctx.lastBvps > 0 ? b / ctx.lastBvps >= 1 / 3 && b / ctx.lastBvps <= 3 : x === s && b >= 1 && b <= 100000;
    };
    const x = tries.find(fits);
    const at = okDate(fp.periodEnd) ? fp.periodEnd : out.periodEnd;
    const recent = ctx.lastEquity != null && ctx.lastEquity > 0 && ctx.lastEquityAt && at && at >= ctx.lastEquityAt && Date.parse(at) - Date.parse(ctx.lastEquityAt) < 270 * 86400000;
    if (x == null) checks.push(`Equity ${fp.totalEquity} left out: its scale is unclear.`);
    else if (recent && Math.abs((fp.totalEquity! * x) / ctx.lastEquity! - 1) > 0.3) checks.push(`Equity ${fp.totalEquity} left out: far from the ${ctx.lastEquityAt} figure.`);
    else {
      out.equity = fp.totalEquity! * x;
      // The revaluation surplus inside it, which the book a share leaves out.
      const rv = fp.revaluationSurplus;
      if (rv != null && rv > 0 && rv < fp.totalEquity!) out.revaluation = rv * x;
    }
  }
  return out;
}
