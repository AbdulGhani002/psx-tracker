import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getAllUserIds } from "@/lib/data";
import { cronAuthorised } from "@/lib/auth/cron";
import { refreshCloses, rebuildUser, rebuiltThrough } from "@/lib/quant/daily";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

// Machine-only, on weekdays after the close (psx-daily-close.timer): the
// exchange's end-of-day file into the price series, then each user's reading.
// A user whose reading was already rebuilt on the latest close is skipped,
// so the second run of the evening costs one request unless the first missed
// the file. Body {force:true} rebuilds anyway; {from:"YYYY-MM-DD"}
// fetches every weekday's file from that date that is not yet kept.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const t0 = Date.now();
  const from = typeof body?.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : undefined;
  const { sheets, bars, indices } = await refreshCloses({ from });
  const latest = bars.latest ?? sheets.latest;
  const users = await getAllUserIds();
  const results: Array<Record<string, unknown>> = [];
  for (const id of users) {
    const done = await rebuiltThrough(id);
    if (body?.force !== true && done && latest && done >= latest) {
      results.push({ user: id.slice(-6), skipped: `already rebuilt on ${done}` });
      continue;
    }
    try {
      results.push({ user: id.slice(-6), ...(await rebuildUser(id, latest)) });
    } catch (e) {
      results.push({ user: id.slice(-6), error: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }
  return NextResponse.json({
    ok: true,
    seconds: Math.round((Date.now() - t0) / 1000),
    sheets,
    bars: { ...bars, days: bars.days.slice(-5), adjusted: bars.adjusted.slice(-20) },
    indices,
    users: results,
  });
}
