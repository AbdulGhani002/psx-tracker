import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { scanBoard, backfillHeld, deliverDueForCurrentUser, type BoardFile, type Delivery } from "@/lib/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 280;

// Every five minutes (psx-announcements.timer): read the exchange's
// company-announcements board, store what is new, and send each user the
// documents of the names they hold (lib/announcements).
//   body: { dryRun?: boolean, sinceHours?: number (48), maxPages?: number (6),
//           backfill?: boolean (also pull each held name's recent board, for history),
//           scan?: boolean (false skips the board and only delivers what is stored) }
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body = await req.json().catch(() => ({} as any));
  const dryRun = body?.dryRun === true;
  const sinceHours = typeof body?.sinceHours === "number" && body.sinceHours > 0 ? body.sinceHours : 48;
  const report: Record<string, unknown> = {};

  if (body?.scan !== false) report.scan = await scanBoard({ sinceHours, maxPages: typeof body?.maxPages === "number" ? body.maxPages : 6 });
  if (body?.backfill === true) report.backfill = await backfillHeld(typeof body?.backfillCount === "number" ? body.backfillCount : 20);

  const users = await getAllUserIds();
  const files = new Map<string, BoardFile | null>();
  const deliveries: Delivery[] = [];
  let considered = 0, sent = 0, partial = 0, failed = 0, skipped = 0;
  for (const uid of users) {
    await runAsUser(uid, async () => {
      const r = await deliverDueForCurrentUser({ sinceHours, dryRun, files });
      considered += r.considered;
      sent += r.sent;
      partial += r.partial;
      failed += r.failed;
      skipped += r.skipped;
      deliveries.push(...r.deliveries);
    });
  }
  const ok = !(report.scan as any)?.refused && failed === 0;
  return NextResponse.json({ ok, ...report, users: users.length, considered, sent, partial, failed, skipped, deliveries: deliveries.map((d) => ({ ...d, title: d.title.slice(0, 80) })) });
}
