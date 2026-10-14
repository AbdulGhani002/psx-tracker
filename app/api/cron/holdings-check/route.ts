import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getPortfolioSummary } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's positions as the holdings table shows them, to
// check from the server (the page needs a signed-in session). Body {user: n}.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const s = await runAsUser(uid, () => getPortfolioSummary());
  const r0 = (v: number) => Math.round(v);
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 100);
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
      dps12m: Math.round(p.dps12m * 100) / 100,
      yieldOnCostPct: pct(p.yield12m),
      sold: p.sold.shares > 0 ? { shares: p.sold.shares, sales: r0(p.sold.proceeds - p.sold.cost), dividends: r0(p.sold.dividends), booked: r0(p.sold.proceeds - p.sold.cost + p.sold.dividends) } : null,
      allTold: r0(p.totalReturn),
      targetPct: p.targetPercent,
      parked: p.parked,
    })),
  });
}
