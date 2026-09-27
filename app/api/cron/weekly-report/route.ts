import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDb } from "@/lib/db";
import { AlertLogModel } from "@/lib/models";
import { getAllUserIds, getAppSettings } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { uid } from "@/lib/auth/uid";
import { cronAuthorised } from "@/lib/auth/cron";
import { sendTelegramDocument, sendTelegram } from "@/lib/notify/telegram";
import { sendEmail } from "@/lib/auth/mailer";
import { getPlaybook } from "@/lib/plan";
import { assembleWeeklyReport, buildWeeklyTex, weeklySummaryText, weeklyEmailHtml } from "@/lib/statement/weekly";
import { buildQuantReport, type QuantReport } from "@/lib/quant/report";
import { quantEmailHtml, quantEmailAttachments } from "@/lib/quant/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TECTONIC = process.env.TECTONIC_BIN ?? "/usr/local/bin/tectonic";
const pExecFile = promisify(execFile);

async function compilePdf(tex: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "psx-weekly-"));
  try {
    const texPath = join(dir, "weekly.tex");
    await writeFile(texPath, tex, "utf8");
    await pExecFile(TECTONIC, ["--outdir", dir, texPath], { timeout: 240000 });
    return await readFile(join(dir, "weekly.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Machine-only (systemd timer, Sunday morning). Builds each user's one-page
// plan for the week ahead and delivers it two ways: the PDF to Telegram and the
// same PDF by email. Deduped per user per ISO week so a retry cannot spam;
// body {force:true} re-sends regardless.
//
// Delivery is deliberately independent: a failed Telegram send must not stop
// the email, and vice versa. A weekly discipline document that silently stops
// arriving is worse than one that arrives twice.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const force = body?.force === true;
  // {emailOnly:true} skips Telegram: for checking the email without a second
  // PDF landing on the phone.
  const emailOnly = body?.emailOnly === true;
  const userIds = await getAllUserIds();
  let telegramSent = 0;
  let emailSent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    await runAsUser(userId, async () => {
      const settings: any = await getAppSettings();
      const pb: any = await getPlaybook();
      if (!pb?.weeklyReportEnabled) {
        skipped++;
        return;
      }

      const token = settings.telegramBotToken ?? "";
      const chatId = settings.telegramChatId ?? "";
      const email = String(pb.weeklyReportEmail ?? "").trim();
      if (!token && !email) {
        skipped++;
        return;
      }

      const data = await assembleWeeklyReport();
      const dedupeKey = `weekly-plan:${data.weekKey}`;
      if (!force) {
        try {
          await AlertLogModel.create({
            userId: await uid(),
            dedupeKey,
            kind: "weekly-plan",
            message: data.weekLabel,
          });
        } catch {
          skipped++; // already sent this week
          return;
        }
      }

      let pdf: Buffer | null = null;
      try {
        pdf = await compilePdf(buildWeeklyTex(data));
      } catch (e) {
        errors.push(`pdf: ${String(e).slice(0, 160)}`);
      }

      const filename = `weekly-plan-${data.weekKey}.pdf`;
      const caption = weeklySummaryText(data).slice(0, 1000);

      // The charts and the model's long text. A failure here must not cost
      // the plan its delivery.
      let quant: QuantReport | null = null;
      try {
        quant = await buildQuantReport();
      } catch (e) {
        errors.push(`charts: ${String(e).slice(0, 160)}`);
      }

      if (token && chatId && !emailOnly) {
        try {
          if (pdf) {
            const r = await sendTelegramDocument(token, chatId, filename, pdf, caption);
            if (r.ok) telegramSent++;
            else errors.push(r.detail ?? "telegram_failed");
          } else {
            // No PDF is not a reason to stay silent about the week's action.
            const r = await sendTelegram(token, chatId, caption);
            if (r.ok) telegramSent++;
            else errors.push(r.detail ?? "telegram_failed");
          }
        } catch (e) {
          errors.push(`telegram: ${String(e).slice(0, 160)}`);
        }
      }

      if (email) {
        try {
          const attachments: Array<{ filename: string; content: Buffer; contentId?: string }> = pdf ? [{ filename, content: pdf }] : [];
          if (quant) attachments.push(...quantEmailAttachments(quant));
          const ok = await sendEmail(
            email,
            `Weekly plan and charts — ${data.weekLabel}`,
            weeklyEmailHtml(data) + (quant ? quantEmailHtml(quant) : ""),
            attachments
          );
          if (ok) emailSent++;
          else errors.push("email_failed");
        } catch (e) {
          errors.push(`email: ${String(e).slice(0, 160)}`);
        }
      }
    });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    users: userIds.length,
    telegramSent,
    emailSent,
    skipped,
    errors,
  });
}
