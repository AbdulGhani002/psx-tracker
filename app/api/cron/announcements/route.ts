import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { scanBoard, scanCompanyPages, heldSymbolsAll, backfillHeld, deliverDueForCurrentUser, nextBoardAt, nextPagesAt, shuffled, type BoardFile, type Delivery, type PagesScan } from "@/lib/announcements";

// When the refused board and the company pages are next asked (ISO times).
type Schedule = { boardAt?: string; pagesAt?: string };
const SCHEDULE_KEY = "announcements:schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 280;

// Every five minutes (psx-announcements.timer): read the exchange's
// company-announcements board (or, while it refuses, the held companies' own
// pages), store what is new, and send each user the documents of the names
// they hold (lib/announcements).
//   body: { dryRun?: boolean, sinceHours?: number (48), maxPages?: number (6),
//           backfill?: boolean (also pull each held name's recent board, for history),
//           scan?: boolean (false skips the board and only delivers what is stored),
//           pages?: boolean (read the held companies' pages now), board?: boolean (ask the board now) }
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body = await req.json().catch(() => ({} as any));
  const dryRun = body?.dryRun === true;
  const sinceHours = typeof body?.sinceHours === "number" && body.sinceHours > 0 ? body.sinceHours : 48;
  const report: Record<string, unknown> = {};

  // The board has refused the server since 24 Sep 2026. While it does, it is
  // asked again every five to seven hours, not every tick, and the held
  // companies' own pages stand in for it at random intervals (15 to 30
  // minutes in filing hours, one to two hours otherwise, two hours after a
  // failed read): see nextPagesAt. {board:true} or {pages:true} asks now.
  const now = new Date();
  const sched = (await getFeedSnapshot<Schedule>(SCHEDULE_KEY).catch(() => null))?.data ?? {};
  const boardResting = !!sched.boardAt && now < new Date(sched.boardAt);
  if (body?.scan !== false && (body?.board === true || !boardResting)) {
    const scan = await scanBoard({ sinceHours, maxPages: typeof body?.maxPages === "number" ? body.maxPages : 6 });
    report.scan = scan;
    sched.boardAt = scan.refused ? nextBoardAt(now).toISOString() : undefined;
  }
  if (body?.backfill === true) report.backfill = await backfillHeld(typeof body?.backfillCount === "number" ? body.backfillCount : 20);
  const refused = !!sched.boardAt && now < new Date(sched.boardAt);
  const pagesDue = body?.pages === true || (refused && body?.scan !== false && (!sched.pagesAt || now >= new Date(sched.pagesAt)));
  if (pagesDue) {
    const pages = await scanCompanyPages(shuffled(await heldSymbolsAll()));
    report.pages = pages;
    sched.pagesAt = nextPagesAt(now, pages.read > 0).toISOString();
  }
  if (refused) report.next = { board: sched.boardAt, pages: sched.pagesAt ?? null };
  if (!dryRun) await saveFeedSnapshot(SCHEDULE_KEY, sched, "ok", refused ? `board resting to ${sched.boardAt}, pages next ${sched.pagesAt ?? "-"}` : "board answering").catch(() => {});

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
  // Fine when the board answered, or the pages stood in for it this run (or
  // were not due); not when the pages, too, could not be read.
  const pages = report.pages as PagesScan | undefined;
  const ok = failed === 0 && (!pagesDue || (pages != null && pages.read > 0));
  return NextResponse.json({ ok, ...report, users: users.length, considered, sent, partial, failed, skipped, deliveries: deliveries.map((d) => ({ ...d, title: d.title.slice(0, 80) })) });
}
