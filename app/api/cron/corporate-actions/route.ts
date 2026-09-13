import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { HoldingModel, FundamentalModel } from "@/lib/models";
import { fetchPayouts } from "@/lib/prices/payouts";
import { getAllUserIds, getAppSettings } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { sendTelegram } from "@/lib/notify/telegram";
import { runCorporateActionsForCurrentUser, describeAction } from "@/lib/corporate-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 200;

// Records due dividends and bonus shares for every user (lib/corporate-actions).
//
// Payout boards come in two ways: the laptop's daily push posts them here as
// {payouts: {SYM: [...]}, faceValues: {SYM: n}} (the exchange's portal refuses
// this server most days), and, failing that, the job asks the portal itself
// for the held names with a short time budget. Then each user's ledger is
// brought up to date and a Telegram line goes out for anything written.
//   body: { payouts?, faceValues?, refresh?: boolean (default true), dryRun?: boolean, today?: "YYYY-MM-DD" }

type PushedPayout = { pctOfFace: number; cycle: string; payoutType: string; announceDate?: string | null; bookClosureStart?: string | null; date?: string | null; bookClosure?: string | null };

async function storeBoard(symbol: string, rows: PushedPayout[], faceValue?: number) {
  const payouts = rows
    .filter((p) => p && p.pctOfFace > 0)
    .map((p) => ({ date: p.announceDate ?? p.date ?? p.bookClosureStart ?? p.bookClosure ?? null, bookClosure: p.bookClosureStart ?? p.bookClosure ?? null, pctOfFace: p.pctOfFace, cycle: p.cycle ?? "", payoutType: p.payoutType ?? "cash" }));
  await FundamentalModel.findOneAndUpdate(
    { symbol },
    { $set: { payouts, fetchedAt: new Date(), ...(faceValue && faceValue > 0 ? { faceValue } : {}) }, $setOnInsert: { symbol, sector: "", annual: [], source: "psx-dps" } },
    { upsert: true }
  );
}

export async function POST(req: Request) {
  if (!cronAuthorised()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body = await req.json().catch(() => ({} as any));
  const report: Record<string, unknown> = {};

  if (body?.payouts && typeof body.payouts === "object") {
    let n = 0;
    for (const [sym, rows] of Object.entries(body.payouts as Record<string, PushedPayout[]>)) {
      if (!Array.isArray(rows)) continue;
      await storeBoard(sym.toUpperCase(), rows, body.faceValues?.[sym]);
      n++;
    }
    report.pushed = n;
  } else if (body?.refresh !== false) {
    // The portal blocks this address after bursts; stop at the second miss.
    const held = await HoldingModel.find({ currentShares: { $gt: 0 } }, { symbol: 1 }).lean();
    const symbols = [...new Set((held as any[]).map((h) => h.symbol as string))];
    const started = Date.now();
    let ok = 0, miss = 0;
    for (const s of symbols) {
      if (miss >= 2 || Date.now() - started > 60_000) break;
      const rows = await fetchPayouts(s);
      if (rows == null) {
        miss++;
        continue;
      }
      await storeBoard(s, rows.map((p) => ({ pctOfFace: p.pctOfFace, cycle: p.cycle, payoutType: p.payoutType, announceDate: p.announceDate, bookClosureStart: p.bookClosureStart })));
      ok++;
      await new Promise((r) => setTimeout(r, 700));
    }
    report.portal = { refreshed: ok, missed: miss, of: symbols.length };
  }

  const users = await getAllUserIds();
  let recorded = 0, skipped = 0, notified = 0;
  const lines: string[] = [];
  for (const uid of users) {
    await runAsUser(uid, async () => {
      const r = await runCorporateActionsForCurrentUser({ dryRun: body?.dryRun === true, today: typeof body?.today === "string" ? body.today : undefined });
      recorded += r.recorded.length;
      skipped += r.skipped.length;
      if (body?.dryRun) lines.push(...r.recorded.map((a) => `${uid.slice(-6)}: ${describeAction(a)}`), ...r.skipped.map((s) => `${uid.slice(-6)}: skip ${s.symbol} ${s.type} ${s.bookClosure}: ${s.reason}`));
      if (r.recorded.length === 0 || body?.dryRun) return;
      const s: any = await getAppSettings();
      if (!s.telegramBotToken || !s.telegramChatId) return;
      const text = ["<b>Recorded automatically</b>", ...r.recorded.map((a) => `• ${describeAction(a)}`), "", "A warrant uploaded later replaces the figures."].join("\n");
      const sent = await sendTelegram(s.telegramBotToken, s.telegramChatId, text);
      if (sent.ok) notified++;
    });
  }
  return NextResponse.json({ ok: true, ...report, users: users.length, recorded, skipped, notified, ...(body?.dryRun ? { lines } : {}) });
}
