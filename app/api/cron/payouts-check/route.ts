import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getDividendForecast } from "@/lib/data";
import { getAnnouncedActions } from "@/lib/corporate-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's payouts as the Payouts tab shows them (announced
// on the exchange, then expected later this year), to check from the server.
// Body {user: n}.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const [f, announced] = await runAsUser(uid, () => Promise.all([getDividendForecast(), getAnnouncedActions().catch(() => ({ upcoming: [], recorded: [] }))]));
  const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  return NextResponse.json({
    ok: true,
    announced: announced.upcoming.map((a: any) => `${a.symbol} ${a.type} ${a.pctOfFace}% book closure ${day(a.bookClosure)} ${a.status}`),
    due: f.due.map((e) => `${day(e.date)} ${e.symbol} ${e.expectedRatePerShare.toFixed(2)} x ${Math.round(e.shares)} = ${Math.round(e.expectedGross)} (from ${day(e.basedOn)})`),
  });
}
