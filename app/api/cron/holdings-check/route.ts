import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getPortfolioSummary, getDividendForecast } from "@/lib/data";
import { getFyProfits } from "@/lib/analytics/fy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's positions as the holdings table shows them, and
// the Yearly tab's figures, to check from the server (the pages need a
// signed-in session). Body {user: n}.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const [s, fy, forecast] = await runAsUser(uid, () => Promise.all([getPortfolioSummary(), getFyProfits(), getDividendForecast().catch(() => null)]));
  const r0 = (v: number) => Math.round(v);
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 100);
  const one = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const dps = new Map((forecast?.profiles ?? []).filter((f) => f.declaredAnnualDps > 0).map((f) => [f.symbol, f]));
  return NextResponse.json({
    ok: true,
    positions: [...s.positions, ...s.parked].map((p) => ({
      symbol: p.symbol,
      shares: p.shares,
      cost: r0(p.totalCost),
      open: r0(p.unrealizedPL),
      heldDividends: r0(p.heldDividends),
      totalPnl: r0(p.unrealizedPL + p.heldDividends),
      totalPnlPct: p.totalCost > 0 ? pct((p.unrealizedPL + p.heldDividends) / p.totalCost) : null,
      sold: p.sold.shares > 0 ? { shares: p.sold.shares, sales: r0(p.sold.proceeds - p.sold.cost), dividends: r0(p.sold.dividends), booked: r0(p.sold.proceeds - p.sold.cost + p.sold.dividends) } : null,
      allTold: r0(p.totalReturn),
      yieldOnCost: { dividends: r0(p.dividendsReceived), trades: r0(p.realizedPL), open: r0(p.unrealizedPL), atWork: r0(p.moneyAtWork), days: p.daysHeld, pct: pct(p.moneyAtWork > 0 ? p.totalReturn / p.moneyAtWork : null) },
      dividendYieldOnCost: dps.has(p.symbol) && p.avgCost > 0 ? { dps: dps.get(p.symbol)!.declaredAnnualDps, year: dps.get(p.symbol)!.declaredLabel, avgCost: Math.round(p.avgCost * 100) / 100, pct: pct(dps.get(p.symbol)!.declaredAnnualDps / p.avgCost) } : null,
      targetPct: p.targetPercent,
      parked: p.parked,
    })),
    years: fy.years.map((y) => ({
      fy: y.fy.label,
      current: y.fy.current,
      profit: r0(y.profit),
      pct: one(y.returnPct),
      stocks: Object.fromEntries(y.stocks.map((x) => [x.symbol, { profit: r0(x.profit), pct: one(x.returnPct) }])),
    })),
  });
}
