import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { marketEvents, marketHolidays, refreshMpcDates } from "@/lib/market-calendar";
import { eventsMessage } from "@/lib/calculations/market-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: the market's dates for the next {days} (default 60), the
// evening alert as it would read on {date} (default today), and with
// {refresh:true} the MPC headlines read now.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  const today = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.min(400, Number(body?.days ?? 60)));
  const refreshed = body?.refresh === true ? await refreshMpcDates(true).catch((e) => ({ error: String(e).slice(0, 200) })) : null;
  const until = new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const events = await marketEvents(today, until);
  return NextResponse.json({ ok: true, today, refreshed, events, alert: eventsMessage(events, today, await marketHolidays()) });
}
