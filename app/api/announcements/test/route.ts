import { NextResponse } from "next/server";
import { sendLatestToCurrentUser } from "@/lib/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The Settings button: sends the latest announcement of a held name now, so
// the Telegram and email delivery can be seen working.
export async function POST() {
  const r = await sendLatestToCurrentUser();
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
