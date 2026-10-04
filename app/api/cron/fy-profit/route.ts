import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds } from "@/lib/data";
import { getFyProfits } from "@/lib/analytics/fy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's profit by financial year, to check the figures
// from the server (the page needs a signed-in session). Body {user: n}.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const t0 = Date.now();
  const b = await runAsUser(uid, () => getFyProfits());
  const r = (v: number) => Math.round(v);
  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    firstTrade: b.firstTrade,
    years: b.years.map((y) => ({
      fy: y.fy.label + (y.fy.current ? " (to date)" : ""),
      start: r(y.startValue),
      bought: r(y.bought),
      sold: r(y.sold),
      end: r(y.endValue),
      priceGain: r(y.capitalGain),
      realized: r(y.realized),
      dividends: r(y.dividends),
      profit: r(y.profit),
      returnPct: y.returnPct == null ? null : Math.round(y.returnPct * 100) / 100,
      missing: y.missingPrices,
      stocks: y.stocks.map((s) => `${s.symbol} ${r(s.profit)} (div ${r(s.dividends)}; ${s.startShares}->${s.endShares} sh)`),
    })),
  });
}
