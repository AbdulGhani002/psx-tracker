import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { cronAuthorised } from "@/lib/auth/cron";
import { getToday, getPortfolioCards, getRecentActivity, getPerformance, getAllocation, getYields, getBookFigures } from "@/lib/analytics/dashboard";
import { getRisk } from "@/lib/analytics/risk";
import { getFbrPack } from "@/lib/data";
import { listPortfolios } from "@/lib/portfolios";
import { indexTickers } from "@/lib/timeseries/eod-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Runs every reader the dashboard pages depend on, as the first user, and
// reports shapes and timings. Machine-only: it is how a deploy is checked
// from the shell when nobody can sign in from there.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const userIds = await getAllUserIds();
  const id = typeof body?.userId === "string" && userIds.includes(body.userId) ? body.userId : userIds[0];
  const out: Record<string, unknown> = {};
  const time = async <T,>(name: string, fn: () => Promise<T>, pick: (v: T) => unknown) => {
    const t0 = Date.now();
    try {
      const v = await fn();
      out[name] = { ms: Date.now() - t0, ...(pick(v) as object) };
    } catch (e) {
      out[name] = { ms: Date.now() - t0, error: String(e instanceof Error ? e.message : e).slice(0, 300) };
    }
  };
  await runAsUser(id, async () => {
    await time("tickers", indexTickers, (v) => ({ n: v.length, first: v[0] }));
    await time("portfolios", listPortfolios, (v) => ({ n: v.length, names: v.map((p) => p.name) }));
    await time("today", getToday, (v) => ({ asOf: v.asOf, profit: Math.round(v.profit), names: v.names.length, gainers: v.gainers.map((g) => g.symbol) }));
    await time("allocation", getAllocation, (v) => ({ total: Math.round(v.total), slices: v.slices.map((s) => `${s.label} ${Math.round(s.value)}`) }));
    await time("cards", getPortfolioCards, (v) => ({ n: v.length, totals: v.map((c) => `${c.portfolio.name} ${Math.round(c.total)}`), returns: v.map((c) => `${Math.round(c.invested)} in, ${Math.round(c.totalReturn)} back`) }));
    await time("book", getBookFigures, (v) => ({ netWorth: Math.round(v.netWorth), invested: Math.round(v.invested), costBasis: Math.round(v.costBasis), identity: Math.round(v.netWorth - v.invested - v.totalReturn), totalReturn: Math.round(v.totalReturn), sharesReturn: Math.round(v.equity.total), fundGain: Math.round(v.funds.gain), fundPerDay: Math.round(v.funds.perDay), today: Math.round(v.todayProfit) }));
    await time("activity", () => getRecentActivity(5), (v) => ({ n: v.length, first: v[0] }));
    await time("performanceALL", () => getPerformance("ALL"), (v) => (v ? { points: v.points.length, months: v.monthly.months, twr: v.summary?.twrPct, bench: v.summary?.benchPct, maxDD: v.summary?.maxDrawdownPct, daily: v.daily.length, stale: v.stale } : { none: true }));
    await time("performance1Y", () => getPerformance("1Y"), (v) => (v ? { points: v.points.length, twr: v.summary?.twrPct } : { none: true }));
    await time("yields", getYields, (v) => ({ rows: v.rows.length, ttm: Math.round(v.ttmTotal), yieldPct: v.portfolioYieldPct }));
    await time("risk", getRisk, (v) => (v ? { names: v.names.length, var95: Math.round(v.portfolio.var95Rs), vol: v.portfolio.vol1yPct, beta: v.portfolio.beta, scenarios: v.scenarios.length } : { none: true }));
    await time("fbr", () => getFbrPack(), (v) => ({ year: v.year.label, disposals: v.disposals.length, dividends: v.dividends.length, cgt: v.cgt.cgt }));
  });
  return NextResponse.json({ ok: true, user: id.slice(-6), checks: out });
}
