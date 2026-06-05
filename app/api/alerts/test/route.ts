import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/data";
import { sendTelegram } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const s: any = await getAppSettings();
  if (!s.telegramBotToken || !s.telegramChatId) {
    return NextResponse.json({ ok: false, detail: "Set bot token and chat id first." }, { status: 400 });
  }
  const r = await sendTelegram(
    s.telegramBotToken,
    s.telegramChatId,
    "✅ <b>PSX Portfolio</b> — test alert. Notifications are working."
  );
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
