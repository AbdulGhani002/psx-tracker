import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { connectDb } from "@/lib/db";
import { AnnouncementModel, FundamentalModel, HoldingModel } from "@/lib/models";
import { fetchBoardFile, type BoardFile } from "@/lib/calculations/announcements";
import { isDividendLetter, mergeLetterPayout, parsePayoutLetter, type StoredPayout } from "@/lib/calculations/payout-letter";

// Dividends from the companies' own letters. The exchange's payout list
// refuses automated requests, so for every results, payout or general-meeting
// letter of a company someone holds, the PDF is read (its text, or OCR on a
// scanned one: pdftoppm and tesseract on the server) and what it says goes
// into the company's payout list (lib/calculations/payout-letter.ts). The
// ex-dividend message and the dividend the ledger records at book closure
// both read that list. Each letter is read once; what was found is kept on
// the announcement.

const pExec = promisify(execFile);
const PDFTOPPM = process.env.PDFTOPPM_BIN ?? "/usr/bin/pdftoppm";
const TESSERACT = process.env.TESSERACT_BIN ?? "/usr/bin/tesseract";
const KINDS = ["results", "payout", "agm"];

// The first pages are the letter itself; the later ones (to 20) are read for
// the book closure only, as the statements behind a results letter repeat
// earlier dividends.
async function pdfText(bytes: Buffer, pages = 3): Promise<{ first: string; rest: string }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const all = Array.isArray(text) ? text : [String(text ?? "")];
    return { first: all.slice(0, pages).join("\n"), rest: all.slice(pages, 20).join("\n") };
  } catch {
    return { first: "", rest: "" };
  }
}

// A scanned letter: its first pages through OCR, when the tools are there.
async function ocrText(bytes: Buffer, pages = 3): Promise<string | null> {
  if (!existsSync(PDFTOPPM) || !existsSync(TESSERACT)) return null;
  const dir = await mkdtemp(join(tmpdir(), "psx-letter-"));
  try {
    const pdf = join(dir, "letter.pdf");
    await writeFile(pdf, bytes);
    await pExec(PDFTOPPM, ["-r", "200", "-gray", "-f", "1", "-l", String(pages), "-png", pdf, join(dir, "page")], { timeout: 180_000 });
    let out = "";
    for (const f of (await readdir(dir)).filter((x) => x.startsWith("page") && x.endsWith(".png")).sort()) {
      const { stdout } = await pExec(TESSERACT, [join(dir, f), "-", "--psm", "4"], { timeout: 180_000, maxBuffer: 8 << 20 });
      out += `${stdout}\n`;
    }
    return out;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const pkDay = (d: Date) => new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);

export type LetterRead = { symbol: string; title: string; status: string; method: string; pct?: number | null; rs?: number | null; cycle?: string; bookClosure?: string | null };

// `symbols` narrows a run to some companies (an operator's re-read).
export async function readPayoutLetters(opts: { files?: Map<string, BoardFile | null>; limit?: number; sinceDays?: number; symbols?: string[] } = {}): Promise<{ read: LetterRead[]; ocr: boolean }> {
  await connectDb();
  const held = ((await HoldingModel.distinct("symbol", { currentShares: { $gt: 0 } })) as string[]).filter((s) => !opts.symbols?.length || opts.symbols.includes(s));
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 86400000);
  const todo = (await AnnouncementModel.find({
    symbol: { $in: held },
    kind: { $in: KINDS },
    pdfPath: { $regex: "\\.pdf$" },
    announcedAt: { $gte: since },
    $or: [{ payoutRead: { $exists: false } }, { payoutRead: null }, { "payoutRead.status": { $in: ["unfetched", "unreadable"] }, "payoutRead.attempts": { $lt: 3 } }],
  })
    .sort({ announcedAt: 1 })
    .lean()) as any[];

  const read: LetterRead[] = [];
  let done = 0;
  for (const a of todo) {
    if (!isDividendLetter(a.title)) {
      await AnnouncementModel.updateOne({ _id: a._id }, { $set: { payoutRead: { status: "skipped", method: "", at: new Date() } } });
      continue;
    }
    if (done >= (opts.limit ?? 4)) break;
    done++;
    let file = opts.files?.get(a.pdfPath) ?? null;
    if (!file) {
      file = await fetchBoardFile(a.pdfPath);
      opts.files?.set(a.pdfPath, file);
    }
    if (!file) {
      const attempts = Number(a.payoutRead?.attempts ?? 0) + 1;
      await AnnouncementModel.updateOne({ _id: a._id }, { $set: { payoutRead: { status: "unfetched", attempts, at: new Date() } } });
      read.push({ symbol: a.symbol, title: a.title, status: "unfetched", method: "" });
      continue;
    }
    let { first: text, rest } = await pdfText(file.bytes);
    let method = "text";
    if (text.replace(/\s+/g, "").length < 200) {
      const ocr = await ocrText(file.bytes);
      rest = "";
      if (ocr) {
        text = ocr;
        method = "ocr";
      } else method = "unreadable";
    }
    const on = pkDay(new Date(a.announcedAt ?? a.createdAt));
    const r = method === "unreadable" ? null : parsePayoutLetter(text, on, rest);
    if (r && (r.pctOfFace != null || r.rsPerShare != null || r.bookClosure)) {
      const f: any = await FundamentalModel.findOne({ symbol: a.symbol }, { payouts: 1, faceValue: 1 }).lean();
      const face = r.faceValue ?? Number(f?.faceValue ?? 10);
      const payouts = mergeLetterPayout((f?.payouts ?? []) as StoredPayout[], r, on, face);
      await FundamentalModel.updateOne(
        { symbol: a.symbol },
        { $set: { payouts, ...(r.faceValue ? { faceValue: r.faceValue } : {}) }, $setOnInsert: { symbol: a.symbol, sector: "", annual: [], source: "psx-dps" } },
        { upsert: true }
      );
    }
    const status = !r ? (method === "unreadable" ? "unreadable" : "none") : r.nil ? "nil" : r.pctOfFace != null || r.rsPerShare != null ? "dividend" : r.bookClosure ? "dates" : "none";
    const attempts = status === "unreadable" ? Number(a.payoutRead?.attempts ?? 0) + 1 : undefined;
    await AnnouncementModel.updateOne({ _id: a._id }, { $set: { payoutRead: { status, method, attempts, at: new Date(), cycle: r?.cycle ?? "", pct: r?.pctOfFace ?? null, rs: r?.rsPerShare ?? null, faceValue: r?.faceValue ?? null, bookClosure: r?.bookClosure ?? null, bookClosureEnd: r?.bookClosureEnd ?? null } } });
    read.push({ symbol: a.symbol, title: a.title, status, method, pct: r?.pctOfFace ?? null, rs: r?.rsPerShare ?? null, cycle: r?.cycle ?? "", bookClosure: r?.bookClosure ?? null });
  }
  return { read, ocr: existsSync(PDFTOPPM) && existsSync(TESSERACT) };
}
