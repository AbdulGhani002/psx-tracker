import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { AlertLogModel } from "@/lib/models";
import { getAppSettings, getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { uid } from "@/lib/auth/uid";
import { cronAuthorised } from "@/lib/auth/cron";
import { sendTelegram, sendTelegramPhotos } from "@/lib/notify/telegram";
import { buildQuantReport } from "@/lib/quant/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Machine-only, once per trading day after the close: the index charts, a
// chart per holding, the trend under each, the model's forecast beside its
// measured skill, and a verdict on whether today is a day to add. Deduped per
// user per day; body {force:true} re-sends.
export async function POST(req: Request) {
  if (!cronAuthorised()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const force = await req.json().then((b) => b?.force === true).catch(() => false);
  const userIds = await getAllUserIds();
  const results: Array<{ sent: boolean; reason?: string; charts?: number }> = [];
  for (const id of userIds) {
    results.push(await runAsUser(id, () => runForCurrentUser(force)));
  }
  return NextResponse.json({ ok: true, users: userIds.length, sent: results.filter((r) => r.sent).length });
}

async function runForCurrentUser(force: boolean): Promise<{ sent: boolean; reason?: string; charts?: number }> {
  const settings: any = await getAppSettings();
  const token = settings.telegramBotToken ?? "";
  const chatId = settings.telegramChatId ?? "";
  if (!settings.alertsEnabled || !token || !chatId) return { sent: false, reason: "telegram_not_configured" };

  const today = new Date().toISOString().slice(0, 10);
  const myId = await uid();
  const key = `quant-report:${today}`;
  if (!force) {
    try {
      await AlertLogModel.create({ userId: myId, dedupeKey: key, kind: "quant-report", message: "daily charts" });
    } catch {
      return { sent: false, reason: "already_sent_today" };
    }
  }

  const report = await buildQuantReport();
  if (report.indices.length + report.holdings.length === 0) return { sent: false, reason: "no_charts" };

  // Summary first, then the pictures in albums of at most ten. Each album
  // send is independent so a failed batch does not stop the next.
  await sendTelegram(token, chatId, report.summary);
  let charts = 0;
  const all = [...report.indices, ...report.holdings];
  for (let i = 0; i < all.length; i += 10) {
    const batch = all.slice(i, i + 10).map((it) => ({ png: it.png, caption: it.caption, filename: `${it.symbol}.png` }));
    const r = await sendTelegramPhotos(token, chatId, batch);
    if (r.ok) charts += batch.length;
  }
  return { sent: charts > 0, charts };
}
