import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { pagesWanted, sweepState, sweepTick } from "@/lib/prices/sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 280;

// Machine-only: one tick of the day's read of the exchange's site
// (lib/prices/sweep), from psx-sweep.timer. Body {status: true}: where the
// sweep stands and what it would read, reading nothing.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  if (body?.status === true) {
    const [s, wanted] = await Promise.all([sweepState(), pagesWanted()]);
    return NextResponse.json({ ok: true, sweep: s ? { ...s, items: s.items.length } : null, wanted });
  }
  return NextResponse.json({ ok: true, ...(await sweepTick()) });
}
