import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { AlertLogModel } from "@/lib/models";
import { getAppSettings, getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { uid } from "@/lib/auth/uid";
import { cronAuthorised } from "@/lib/auth/cron";
import { sendTelegram, sendTelegramPhotos } from "@/lib/notify/telegram";
import { sendEmail } from "@/lib/auth/mailer";
import { getPlaybook } from "@/lib/plan";
import { buildQuantReport } from "@/lib/quant/report";
import { quantEmailHtml, quantEmailAttachments } from "@/lib/quant/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Machine-only, once per trading day after the close: the index charts, a
// chart per holding, the trend under each, the model's odds beside their
// measured record, and a verdict on whether today is a day to add. Deduped per
// user per day; body {force:true} re-sends; body {dryRun:true, userId} builds
// the report for that user and returns the text without sending anything, so
// the wording can be read before it reaches a phone.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const force = body?.force === true;
  // {email:true} also mails the list, the text and the KSE-100 chart to the
  // address the weekly report goes to ({email:"full"} adds every chart; the
  // Sunday email carries them anyway). The daily run does not pass it.
  const withEmail = body?.email === true || body?.email === "full" || body?.email === "light";
  const fullEmail = body?.email === "full";
  // {telegram:false} builds and emails without sending the phone the album again.
  const skipTelegram = body?.telegram === false;
  const userIds = await getAllUserIds();
  if (body?.dryRun === true) {
    const id = typeof body.userId === "string" && userIds.includes(body.userId) ? body.userId : userIds[0];
    if (!id) return NextResponse.json({ error: "no users" }, { status: 404 });
    const report = await runAsUser(id, () => buildQuantReport());
    return NextResponse.json({
      ok: true,
      userId: id,
      model: report.model,
      summary: report.summary,
      charts: [...report.indices, ...report.holdings].map((it) => ({ symbol: it.symbol, verdict: it.verdict, bytes: it.png.length, caption: it.caption })),
    });
  }
  const results: Array<{ sent: boolean; reason?: string; charts?: number; emailed?: boolean; errors?: string[] }> = [];
  for (const id of userIds) {
    results.push(await runAsUser(id, () => runForCurrentUser(force, withEmail, fullEmail, skipTelegram)));
  }
  return NextResponse.json({
    ok: true,
    users: userIds.length,
    sent: results.filter((r) => r.sent).length,
    // Why each user did or did not get it, so a silent zero can be read.
    results: results.map((r, i) => ({ user: userIds[i].slice(-6), sent: r.sent, reason: r.reason ?? null, charts: r.charts ?? 0, emailed: r.emailed ?? false })),
    errors: results.flatMap((r) => r.errors ?? []),
  });
}

async function runForCurrentUser(force: boolean, withEmail = false, fullEmail = false, skipTelegram = false): Promise<{ sent: boolean; reason?: string; charts?: number; emailed?: boolean; errors?: string[] }> {
  const settings: any = await getAppSettings();
  const token = settings.telegramBotToken ?? "";
  const chatId = settings.telegramChatId ?? "";
  // The charts and the next-day read are a separate thing from the portfolio
  // reports; turned off in Settings, nothing is built and nothing is sent.
  if (settings.telegramQuant === false) skipTelegram = true;
  if (skipTelegram && !withEmail) return { sent: false, reason: "quant_report_off" };
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
  // send is independent so a failed batch does not stop the next, and every
  // refusal is written down: a report that silently stops arriving is worse
  // than one that says why.
  const errors: string[] = [];
  let charts = 0;
  const all = skipTelegram ? [] : [...report.indices, ...report.holdings];
  if (!skipTelegram) {
    const s = await sendTelegram(token, chatId, report.summary);
    if (!s.ok) errors.push(`summary: ${s.detail ?? "failed"}`);
  }
  for (let i = 0; i < all.length; i += 10) {
    const batch = all.slice(i, i + 10).map((it) => ({ png: it.png, caption: it.caption, filename: `${it.symbol}.png` }));
    const r = await sendTelegramPhotos(token, chatId, batch);
    if (r.ok) charts += batch.length;
    else errors.push(`album ${i / 10 + 1} (${batch.map((b) => b.filename).join(",")}): ${r.detail ?? "failed"}`);
  }
  let emailed = false;
  if (withEmail) {
    try {
      const pb: any = await getPlaybook();
      const email = String(pb?.weeklyReportEmail ?? "").trim();
      if (!email) errors.push("email: no address on the playbook");
      else {
        emailed = await sendEmail(email, `The model's list and zones, ${report.date}`, quantEmailHtml(report, { heading: "The model's list and zones", light: !fullEmail }), quantEmailAttachments(report, !fullEmail));
        if (!emailed) errors.push("email: send failed");
      }
    } catch (e) {
      errors.push(`email: ${String(e).slice(0, 160)}`);
    }
  }
  if (errors.length) console.log(`[quant-report] ${errors.join(" | ")}`);
  return { sent: charts > 0, charts, emailed, errors };
}
