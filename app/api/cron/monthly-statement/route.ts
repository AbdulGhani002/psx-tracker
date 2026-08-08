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
import { sendTelegramDocument } from "@/lib/notify/telegram";
import { assembleMonthlyStatement, buildStatementTex } from "@/lib/statement/monthly";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TECTONIC = process.env.TECTONIC_BIN ?? "/usr/local/bin/tectonic";
const pExecFile = promisify(execFile);

// Compile LaTeX → PDF with tectonic in a scratch dir. Throws with the log tail
// on failure — a broken template must never send a half-made document.
async function compilePdf(tex: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "psx-stmt-"));
  try {
    const texPath = join(dir, "statement.tex");
    await writeFile(texPath, tex, "utf8");
    await pExecFile(TECTONIC, ["--outdir", dir, texPath], { timeout: 240000 });
    return await readFile(join(dir, "statement.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Machine-only (systemd timer, 1st of the month). Builds each user's statement
// for the month that just ended and sends it to their Telegram. Deduped per
// user per month, so re-runs are safe; body {force:true} re-sends regardless.
export async function POST(req: Request) {
  if (!cronAuthorised()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const force = await req.json().then((b) => b?.force === true).catch(() => false);
  const userIds = await getAllUserIds();
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    await runAsUser(userId, async () => {
      const settings: any = await getAppSettings();
      const token = settings.telegramBotToken ?? "";
      const chatId = settings.telegramChatId ?? "";
      if (!settings.alertsEnabled || !token || !chatId) { skipped++; return; }

      const data = await assembleMonthlyStatement();
      const dedupeKey = `monthly-stmt:${data.monthKey}`;
      if (!force) {
        try {
          await AlertLogModel.create({ userId: await uid(), dedupeKey, kind: "monthly-stmt", message: data.monthLabel });
        } catch {
          skipped++; // already sent this month
          return;
        }
      }
      try {
        const pdf = await compilePdf(buildStatementTex(data));
        const r = await sendTelegramDocument(token, chatId, `psx-statement-${data.monthKey}.pdf`, pdf, `📄 ${data.monthLabel} statement`);
        if (r.ok) sent++;
        else errors.push(r.detail ?? "telegram_failed");
      } catch (e) {
        errors.push(String(e).slice(0, 200));
      }
    });
  }
  // Aggregate-only response — same rule as the alerts cron.
  return NextResponse.json({ ok: errors.length === 0, users: userIds.length, sent, skipped, errors });
}
