import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { cronAuthorised } from "@/lib/auth/cron";
import { refreshCloses } from "@/lib/quant/daily";
import { refreshIndexForecasts } from "@/lib/index-week/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

// Machine-only, on weekdays after the close (psx-daily-close.timer): the
// exchange's end-of-day file into the price series and the index series,
// then the indexes' levels for the week and the month ahead (lib/index-week).
// The buy list is moved on by the alerts job, from the same kept files.
// Body {from:"YYYY-MM-DD"} fetches every weekday's file from that date that is
// not yet kept; {force:true} works the levels out again anyway.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const t0 = Date.now();
  const from = typeof body?.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : undefined;
  const { sheets, bars, indices } = await refreshCloses({ from });
  const changed = bars.appended > 0 || sheets.fetched.length > 0 || indices.some((i) => i.added > 0) || body?.force === true;
  const forecasts = changed ? await refreshIndexForecasts().catch((e) => ({ error: String(e).slice(0, 200) })) : null;
  return NextResponse.json({
    ok: true,
    seconds: Math.round((Date.now() - t0) / 1000),
    sheets,
    bars: { ...bars, days: bars.days.slice(-5), adjusted: bars.adjusted.slice(-20) },
    indices,
    forecasts: forecasts && "indexes" in forecasts ? { asOf: forecasts.asOf, indexes: forecasts.indexes.map((i) => `${i.code} ${i.date}`) } : forecasts,
  });
}
