import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { pagesWanted, readAlerts, sweepState, sweepTick } from "@/lib/prices/sweep";
import { getAllUserIds } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 280;

// Machine-only: one tick of the day's read of the exchange's site
// (lib/prices/sweep), from psx-sweep.timer. Body {status: true}: where the
// sweep stands, what it would read and the report lines the first user
// would get now (lib/prices/sweep readAlerts), reading and sending nothing.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  if (body?.status === true) {
    const [s, wanted, ids] = await Promise.all([sweepState(), pagesWanted(), getAllUserIds()]);
    const report = ids[0] ? await readAlerts(ids[0]).catch((e) => [{ key: "error", message: String(e).slice(0, 200) }]) : [];
    return NextResponse.json({ ok: true, sweep: s ? { ...s, items: s.items.length } : null, wanted, report });
  }
  return NextResponse.json({ ok: true, ...(await sweepTick()) });
}
