import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { RateSnapshotModel } from "@/lib/models";
import { getAppSettings } from "@/lib/data";
import { getRateSnapshots, getRatesPrefill, getStrategy } from "@/lib/strategy/data";
import { sendTelegram } from "@/lib/notify/telegram";
import { appOrigin } from "@/lib/auth/mailer";

export const dynamic = "force-dynamic";

// The month's interest rates. Saving them works the strategy out again and,
// when Telegram is set up, sends what it now says.
const rate = z.number().min(0).max(100).nullable().optional();
const postSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  policyPct: rate,
  tbill3mPct: rate,
  tbill6mPct: rate,
  tbill12mPct: rate,
  sukukPct: rate,
  savingsPct: rate,
  moneyMarketPct: rate,
  inflationPct: z.number().min(-50).max(100).nullable().optional(),
  taxPct: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  notify: z.boolean().default(true),
});

export async function GET() {
  const [history, prefill] = await Promise.all([getRateSnapshots(), getRatesPrefill()]);
  return NextResponse.json({ history, prefill });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  try {
    const { notify, ...p } = postSchema.parse(await req.json());
    await connectDb();
    const userId = await uid();
    await RateSnapshotModel.findOneAndUpdate({ userId, month: p.month }, { $set: { ...p, userId } }, { upsert: true });
    let sent = false;
    if (notify) {
      const [s, settings] = await Promise.all([getStrategy(), getAppSettings()]);
      const token = (settings as any).telegramBotToken, chatId = (settings as any).telegramChatId;
      if (token && chatId) {
        const label = new Date(p.month + "-01T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
        const text = [`📊 <b>Strategy for ${esc(label)}</b>`, ...s.plan.steps.map((x) => `• ${esc(x)}`), "", `<a href="${appOrigin()}/strategy">Open the strategy</a>`].join("\n");
        sent = (await sendTelegram(token, chatId, text.slice(0, 4000))).ok;
      }
    }
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
