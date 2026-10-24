import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds } from "@/lib/data";
import { dailyBriefForCurrentUser } from "@/lib/daily-brief";
import { missedReviewForCurrentUser } from "@/lib/missed-trades";
import { getCashCalendar } from "@/lib/cash-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's evening brief (for {date}, default the latest
// closing file's day), the buy list's review for {month} and the cash
// calendar, as text, sending nothing.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const month = typeof body?.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : new Date(Date.now() + 5 * 3600_000 - 31 * 86400000).toISOString().slice(0, 7);
  const out = await runAsUser(uid, async () => ({
    brief: await dailyBriefForCurrentUser(date).catch((e) => `error: ${String(e).slice(0, 200)}`),
    review: await missedReviewForCurrentUser(month).catch((e) => `error: ${String(e).slice(0, 200)}`),
    calendar: await getCashCalendar().catch((e) => ({ error: String(e).slice(0, 200) })),
  }));
  return NextResponse.json({ ok: true, date, month, ...out });
}
