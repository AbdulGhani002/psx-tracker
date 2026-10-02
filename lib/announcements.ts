import { getCurrentUserId } from "@/lib/auth/current-user";
import { connectDb } from "@/lib/db";
import { AnnouncementModel, HoldingModel, UserModel } from "@/lib/models";
import { getAppSettings } from "@/lib/data";
import { sendTelegram, sendTelegramDocument } from "@/lib/notify/telegram";
import { sendEmail, appOrigin } from "@/lib/auth/mailer";
import { fetchCompanyPage } from "@/lib/prices/fundamentals";
import { fetchBoard, fetchBoardFile, parseCompanyAnnouncements, fileNameFor, fileUrl, telegramText, emailSubject, emailHtml, classifyAnnouncement, announcementPasses, type BoardRow, type BoardFile, type AnnounceLevel, type AnnouncementKind } from "@/lib/calculations/announcements";

export * from "@/lib/calculations/announcements";

// Company announcements for the names a user holds, sent as they appear.
//
// scanBoard() reads the exchange's board and stores every row it has not
// seen. deliverDue() then, for each user, takes the stored rows for the
// names they hold that are newer than the window and not yet sent to them,
// downloads the document once, and sends it to Telegram (the file with a
// caption, or the text with the link when the file cannot go) and by email
// (the file attached when it is small enough). The delivery is claimed on
// the row before anything is sent, so a second run cannot send it twice;
// a failed send is retried on a later run, three times at most.

const TELEGRAM_MAX = 50 * 1024 * 1024; // the Bot API's limit for sendDocument
const EMAIL_MAX = 20 * 1024 * 1024; // Resend allows 40 MB a message, base64 adds a third
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60 * 1000;

export type ScanResult = { pages: number; fetched: number; inserted: number; newest: string | null; refused: boolean };

async function storeRows(rows: BoardRow[]): Promise<number> {
  let inserted = 0;
  for (const r of rows) {
    const res = await AnnouncementModel.updateOne(
      { annId: r.annId },
      { $setOnInsert: { annId: r.annId, symbol: r.symbol, company: r.company, title: r.title, kind: classifyAnnouncement(r.title), announcedAt: r.announcedAt, dateOnly: !!r.dateOnly, pdfPath: r.pdfPath, images: r.images, seenAt: new Date(), deliveries: [] } },
      { upsert: true }
    );
    if (res.upsertedCount > 0) inserted++;
  }
  return inserted;
}

// Reads the board newest first and stops at the first page that held a row
// already known, or one older than the window: the board is in time order,
// so a five-minute tick is one request and a catch-up after downtime walks
// back as far as it must.
export async function scanBoard(opts: { sinceHours?: number; maxPages?: number } = {}): Promise<ScanResult> {
  await connectDb();
  const since = new Date(Date.now() - (opts.sinceHours ?? 48) * 3600_000);
  const maxPages = opts.maxPages ?? 6;
  let fetched = 0, inserted = 0, pages = 0;
  let newest: Date | null = null;
  for (let page = 0; page < maxPages; page++) {
    const board = await fetchBoard({ offset: page * 100, count: 100 });
    if (!board) return { pages, fetched, inserted, newest: newest?.toISOString() ?? null, refused: true };
    pages++;
    fetched += board.rows.length;
    const added = await storeRows(board.rows);
    inserted += added;
    for (const r of board.rows) if (!newest || r.announcedAt > newest) newest = r.announcedAt;
    const oldest = board.rows.reduce<Date | null>((m, r) => (!m || r.announcedAt < m ? r.announcedAt : m), null);
    if (board.rows.length < 100 || added < board.rows.length || (oldest && oldest < since)) break;
  }
  return { pages, fetched, inserted, newest: newest?.toISOString() ?? null, refused: false };
}

// Every name any user holds: the board is only read for these when it has to
// be read company by company.
export async function heldSymbolsAll(): Promise<string[]> {
  await connectDb();
  const held = await HoldingModel.find({ currentShares: { $gt: 0 } }, { symbol: 1 }).lean();
  return [...new Set((held as any[]).map((h) => String(h.symbol).toUpperCase()))].sort();
}

export type PagesScan = { symbols: number; read: number; fetched: number; inserted: number; failed: string[] };

// Since 24 Sep 2026 the board answers the server's POST with a refusal; the
// exchange still serves each company's own page, whose Announcements block
// lists the same filings with the same document ids. So when the board
// refuses, the held names are read from their pages instead: one page a name,
// two to six seconds apart, and stored as the board's rows would be (a later
// board read of one is the same row). A run that cannot read three pages in
// a row stops. The route decides when (lib/calculations/announcements:
// nextPagesAt) and in what order.
export async function scanCompanyPages(symbols: string[]): Promise<PagesScan> {
  await connectDb();
  const out: PagesScan = { symbols: symbols.length, read: 0, fetched: 0, inserted: 0, failed: [] };
  let misses = 0;
  for (const s of symbols) {
    const html = await fetchCompanyPage(s);
    const rows = html ? parseCompanyAnnouncements(html, s) : [];
    if (rows.length === 0) {
      out.failed.push(s);
      if (++misses >= 3) break;
    } else {
      misses = 0;
      out.read++;
      out.fetched += rows.length;
      out.inserted += await storeRows(rows);
    }
    await new Promise((r) => setTimeout(r, 2000 + 4000 * Math.random()));
  }
  return out;
}

// The recent board of each held name, for the history behind the cards. Not
// delivered: anything older than the window is stored as already seen.
export async function backfillHeld(count = 20): Promise<{ symbols: number; inserted: number; refused: string[] }> {
  await connectDb();
  const held = await HoldingModel.find({ currentShares: { $gt: 0 } }, { symbol: 1 }).lean();
  const symbols = [...new Set((held as any[]).map((h) => h.symbol as string))];
  let inserted = 0;
  const refused: string[] = [];
  for (const s of symbols) {
    const board = await fetchBoard({ symbol: s, count });
    if (!board) {
      refused.push(s);
      if (refused.length >= 2) break;
      continue;
    }
    inserted += await storeRows(board.rows.filter((r) => r.symbol === s));
    await new Promise((r) => setTimeout(r, 600));
  }
  return { symbols: symbols.length, inserted, refused };
}

export type Delivery = { user: string; annId: string; symbol: string; title: string; telegram: string; email: string; status: string; error?: string };
export type DeliverResult = { users: number; considered: number; sent: number; partial: number; failed: number; skipped: number; deliveries: Delivery[] };

type Channels = { token: string; chatId: string; telegramLevel: AnnounceLevel; emailTo: string; emailLevel: AnnounceLevel };

// A level was stored as a plain on/off before the filter existed; an old
// `false` still means off, an old `true` means the whole board.
const levelOf = (level: unknown, legacy: unknown, fallback: AnnounceLevel): AnnounceLevel => {
  const v = String(level ?? "");
  if (v === "off" || v === "board" || v === "key" || v === "all") return v;
  return legacy === false ? "off" : fallback;
};

async function channelsFor(userId: string): Promise<Channels> {
  const s: any = await getAppSettings();
  const user: any = await UserModel.findById(userId, { email: 1, emailVerified: 1 }).lean();
  const emailTo = String(s.announceEmailTo ?? "").trim() || (user?.emailVerified ? String(user.email ?? "") : "");
  return {
    token: s.telegramBotToken ?? "",
    chatId: s.telegramChatId ?? "",
    telegramLevel: levelOf(s.announceTelegramLevel, s.announceTelegram, "key"),
    emailTo,
    emailLevel: levelOf(s.announceEmailLevel, s.announceEmail, "all"),
  };
}

async function sendOne(row: BoardRow, ch: Channels, file: BoardFile | null, kind: AnnouncementKind): Promise<{ telegram: string; email: string; error: string }> {
  let telegram = "off", email = "off";
  const errors: string[] = [];
  const toTelegram = announcementPasses(kind, ch.telegramLevel);
  const toEmail = announcementPasses(kind, ch.emailLevel);
  if (toTelegram && ch.token && ch.chatId) {
    let ok = false;
    if (file && file.bytes.length <= TELEGRAM_MAX) {
      const r = await sendTelegramDocument(ch.token, ch.chatId, fileNameFor(row, file.ext), file.bytes, telegramText(row), { contentType: file.contentType, parseMode: "HTML" });
      ok = r.ok;
      if (r.ok) telegram = "sent";
      else errors.push(`telegram file: ${r.detail ?? "failed"}`);
    }
    if (!ok) {
      const r = await sendTelegram(ch.token, ch.chatId, telegramText(row, true));
      telegram = r.ok ? "link" : "failed";
      if (!r.ok) errors.push(`telegram: ${r.detail ?? "failed"}`);
    }
  }
  if (toEmail && ch.emailTo) {
    const attach = file && file.bytes.length <= EMAIL_MAX ? [{ filename: fileNameFor(row, file.ext), content: file.bytes }] : [];
    const ok = await sendEmail(ch.emailTo, emailSubject(row), emailHtml(row, { attached: attach.length > 0, appOrigin: appOrigin() }), attach);
    email = ok ? (attach.length > 0 ? "sent" : "link") : "failed";
    if (!ok) errors.push("email: rejected");
  }
  return { telegram, email, error: errors.join("; ").slice(0, 300) };
}

const statusOf = (telegram: string, email: string) => {
  const live = [telegram, email].filter((s) => s !== "off");
  if (live.length === 0) return "skipped";
  const good = live.filter((s) => s === "sent" || s === "link").length;
  return good === live.length ? "sent" : good > 0 ? "partial" : "failed";
};

// Sends what is due to the current user (wrap in runAsUser for a job).
// `files` is shared across users in one run so a document is fetched once.
export async function deliverDueForCurrentUser(opts: { sinceHours?: number; dryRun?: boolean; files?: Map<string, BoardFile | null> } = {}): Promise<DeliverResult> {
  const userId = await getCurrentUserId();
  const empty: DeliverResult = { users: 0, considered: 0, sent: 0, partial: 0, failed: 0, skipped: 0, deliveries: [] };
  if (!userId) return empty;
  await connectDb();
  const held = await HoldingModel.find({ userId, currentShares: { $gt: 0 } }, { symbol: 1 }).lean();
  const symbols = [...new Set((held as any[]).map((h) => h.symbol as string))];
  if (symbols.length === 0) return { ...empty, users: 1 };
  const since = new Date(Date.now() - (opts.sinceHours ?? 48) * 3600_000);
  const due: any[] = await AnnouncementModel.find({
    symbol: { $in: symbols },
    announcedAt: { $gte: since },
    $or: [{ "deliveries.userId": { $ne: userId } }, { deliveries: { $elemMatch: { userId, status: "failed", attempts: { $lt: MAX_ATTEMPTS }, lastAt: { $lt: new Date(Date.now() - RETRY_AFTER_MS) } } } }],
  })
    .sort({ announcedAt: 1 })
    .lean();
  const out: DeliverResult = { ...empty, users: 1, considered: due.length };
  if (due.length === 0) return out;
  const ch = await channelsFor(userId);
  const files = opts.files ?? new Map<string, BoardFile | null>();

  for (const a of due) {
    const row: BoardRow = { annId: a.annId, symbol: a.symbol, company: a.company, title: a.title, announcedAt: new Date(a.announcedAt), dateOnly: !!a.dateOnly, pdfPath: a.pdfPath ?? "", images: a.images ?? [] };
    const kind: AnnouncementKind = a.kind ?? classifyAnnouncement(row.title);
    if (opts.dryRun) {
      out.deliveries.push({ user: userId.slice(-6), annId: row.annId, symbol: row.symbol, title: row.title, telegram: announcementPasses(kind, ch.telegramLevel) && ch.token && ch.chatId ? "would send" : "off", email: announcementPasses(kind, ch.emailLevel) && ch.emailTo ? "would send" : "off", status: `dry ${kind}` });
      continue;
    }
    // Nothing to send for this one: claim it so it is not looked at again.
    if (!announcementPasses(kind, ch.telegramLevel) && !announcementPasses(kind, ch.emailLevel)) {
      await AnnouncementModel.updateOne({ _id: a._id, "deliveries.userId": { $ne: userId } }, { $push: { deliveries: { userId, status: "skipped", telegram: "off", email: "off", attempts: 1, lastAt: new Date(), error: "" } } });
      out.skipped++;
      continue;
    }
    const now = new Date();
    const claim = await AnnouncementModel.updateOne({ _id: a._id, "deliveries.userId": { $ne: userId } }, { $push: { deliveries: { userId, status: "pending", telegram: "", email: "", attempts: 1, lastAt: now, error: "" } } });
    if (claim.modifiedCount === 0) {
      const retry = await AnnouncementModel.updateOne(
        { _id: a._id, deliveries: { $elemMatch: { userId, status: "failed", attempts: { $lt: MAX_ATTEMPTS }, lastAt: { $lt: new Date(Date.now() - RETRY_AFTER_MS) } } } },
        { $set: { "deliveries.$.status": "pending", "deliveries.$.lastAt": now }, $inc: { "deliveries.$.attempts": 1 } }
      );
      if (retry.modifiedCount === 0) continue; // another run has it
    }
    const path = row.pdfPath || row.images[0] || "";
    if (path && !files.has(row.annId)) files.set(row.annId, await fetchBoardFile(path));
    const file = files.get(row.annId) ?? null;
    if (file && !a.fileBytes) await AnnouncementModel.updateOne({ _id: a._id }, { $set: { fileBytes: file.bytes.length } });

    const r = await sendOne(row, ch, file, kind);
    const status = statusOf(r.telegram, r.email);
    await AnnouncementModel.updateOne({ _id: a._id, "deliveries.userId": userId }, { $set: { "deliveries.$.status": status, "deliveries.$.telegram": r.telegram, "deliveries.$.email": r.email, "deliveries.$.error": r.error, "deliveries.$.lastAt": new Date() } });
    out.deliveries.push({ user: userId.slice(-6), annId: row.annId, symbol: row.symbol, title: row.title, telegram: r.telegram, email: r.email, status, ...(r.error ? { error: r.error } : {}) });
    if (status === "sent") out.sent++;
    else if (status === "partial") out.partial++;
    else if (status === "failed") out.failed++;
    else out.skipped++;
  }
  return out;
}

// The Settings button: the newest stored announcement for a held name (or the
// newest on the board when none is held) goes out now, whatever was sent before.
export async function sendLatestToCurrentUser(): Promise<{ ok: boolean; detail: string; telegram?: string; email?: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, detail: "Not signed in." };
  await connectDb();
  const ch = await channelsFor(userId);
  if (!(ch.telegramLevel !== "off" && ch.token && ch.chatId) && !(ch.emailLevel !== "off" && ch.emailTo)) return { ok: false, detail: "Set the Telegram bot and chat id, or an email address, first." };
  const held = await HoldingModel.find({ userId, currentShares: { $gt: 0 } }, { symbol: 1 }).lean();
  const symbols = [...new Set((held as any[]).map((h) => h.symbol as string))];
  let a: any = symbols.length ? await AnnouncementModel.findOne({ symbol: { $in: symbols } }).sort({ announcedAt: -1 }).lean() : null;
  if (!a) a = await AnnouncementModel.findOne({}).sort({ announcedAt: -1 }).lean();
  if (!a) {
    const board = await fetchBoard({ count: 20 });
    if (!board || board.rows.length === 0) return { ok: false, detail: "The exchange's board could not be read just now; try again in a minute." };
    await storeRows(board.rows);
    a = await AnnouncementModel.findOne({ annId: board.rows[0].annId }).lean();
  }
  const row: BoardRow = { annId: a.annId, symbol: a.symbol, company: a.company, title: a.title, announcedAt: new Date(a.announcedAt), dateOnly: !!a.dateOnly, pdfPath: a.pdfPath ?? "", images: a.images ?? [] };
  const file = await fetchBoardFile(row.pdfPath || row.images[0] || "");
  // The button is a test, so it ignores the filter and sends whatever is newest.
  const r = await sendOne(row, { ...ch, telegramLevel: "all", emailLevel: "all" }, file, "other");
  const status = statusOf(r.telegram, r.email);
  return { ok: status === "sent" || status === "partial", detail: status === "sent" ? `Sent ${row.symbol}: ${row.title}` : r.error || "Nothing was sent.", telegram: r.telegram, email: r.email };
}

export type RecentAnnouncement = { annId: string; symbol: string; company: string; title: string; kind: AnnouncementKind; announcedAt: string; dateOnly: boolean; pdfUrl: string; imageUrl: string; sent: string };

// The latest announcements for the names the current user holds, with what
// was sent to them, for the Overview card and the Announcements page.
export async function getRecentAnnouncements(opts: { limit?: number; days?: number; symbol?: string } = {}): Promise<RecentAnnouncement[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  await connectDb();
  let symbols: string[];
  if (opts.symbol) symbols = [opts.symbol.toUpperCase()];
  else {
    const held = await HoldingModel.find({ userId, currentShares: { $gt: 0 } }, { symbol: 1 }).lean();
    symbols = [...new Set((held as any[]).map((h) => h.symbol as string))];
  }
  if (symbols.length === 0) return [];
  const since = new Date(Date.now() - (opts.days ?? 90) * 86400_000);
  const rows: any[] = await AnnouncementModel.find({ symbol: { $in: symbols }, announcedAt: { $gte: since } }).sort({ announcedAt: -1 }).limit(opts.limit ?? 50).lean();
  return rows.map((a) => {
    const d = (a.deliveries ?? []).find((x: any) => x.userId === userId);
    return { annId: a.annId, symbol: a.symbol, company: a.company ?? "", title: a.title ?? "", kind: (a.kind as AnnouncementKind) ?? classifyAnnouncement(a.title ?? ""), announcedAt: new Date(a.announcedAt).toISOString(), dateOnly: !!a.dateOnly, pdfUrl: fileUrl(a.pdfPath ?? ""), imageUrl: fileUrl(a.images?.[0] ?? ""), sent: d ? d.status : "" };
  });
}
