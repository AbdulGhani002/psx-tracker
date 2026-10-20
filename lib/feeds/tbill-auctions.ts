import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel } from "@/lib/models";
import { auctionOn, htmlText, isAuctionLink, mergeAuctions, parseAuction, type Auction } from "./tbill-parse";

// SBP's T-bill auctions, kept as they happen: every six hours the hourly
// snapshot job looks at Mettis Global's fixed-income page for auction reports
// it has not read, reads each one's cut-off yields (tbill-parse.ts) and adds
// them to the history. The Yearly tab takes each year's rate from it, and the
// strategy's rates their T-bill. Honest user agent, a page and a report or
// two a run; a refusal waits for the next run.

const KEY = "tbill:auctions";
const LIST_URL = "https://mettisglobal.news/Fixedincome";
const BASE = "https://mettisglobal.news/";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
const EVERY_MS = 6 * 3600_000;

type Stored = { auctions: Auction[]; lastId: number; checkedAt: string; status: string };

async function stored(): Promise<Stored> {
  await connectDb();
  const d: any = await FeedSnapshotModel.findOne({ key: KEY }, { data: 1 }).lean();
  const data = (d?.data ?? null) as Stored | null;
  return { auctions: data?.auctions ?? [], lastId: data?.lastId ?? 0, checkedAt: data?.checkedAt ?? "", status: data?.status ?? "" };
}

// Every auction kept in the database, oldest first.
export async function getTbillAuctions(): Promise<Auction[]> {
  const s = await stored().catch(() => null);
  return mergeAuctions([], s?.auctions ?? []);
}

export async function latestTbillAuction(): Promise<Auction | null> {
  const all = await getTbillAuctions();
  for (let k = all.length - 1; k >= 0; k--) if (all[k].m12 != null || all[k].m3 != null) return all[k];
  return null;
}

export { auctionOn };

async function get(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(20000) }).catch(() => null);
  return res && res.ok ? res.text() : null;
}

export async function refreshTbillAuctions(force = false): Promise<Record<string, unknown>> {
  const s = await stored();
  if (!force && s.checkedAt && Date.now() - Date.parse(s.checkedAt) < EVERY_MS) return { status: "fresh", kept: s.auctions.length, checkedAt: s.checkedAt };
  const save = (data: Stored) => FeedSnapshotModel.updateOne({ key: KEY }, { $set: { key: KEY, data, status: data.status.startsWith("ok") ? "ok" : "error", note: data.status, updatedAt: new Date() } }, { upsert: true });
  const page = await get(LIST_URL);
  if (!page) {
    await save({ ...s, checkedAt: new Date().toISOString(), status: "list refused" });
    return { status: "list refused" };
  }
  const links = new Map<number, string>();
  for (const m of page.matchAll(/href=["'](?:https:\/\/mettisglobal\.news)?\/([A-Za-z0-9-]+-(\d{4,7}))["']/g)) {
    if (isAuctionLink(m[1])) links.set(Number(m[2]), m[1]);
  }
  // The reports not yet read, oldest first, a few a run.
  const todo = [...links.entries()].filter(([id]) => id > s.lastId).sort((a, b) => a[0] - b[0]).slice(-4);
  let auctions = s.auctions;
  let lastId = s.lastId;
  const read: string[] = [];
  for (const [id, slug] of todo) {
    const html = await get(BASE + slug);
    if (!html) break;
    const published = html.match(/(?:article:published_time["']\s*content=["']|"datePublished"\s*:\s*")([^"']+)/)?.[1] ?? null;
    const found = parseAuction(htmlText(html), published, BASE + slug);
    auctions = mergeAuctions(auctions, found);
    lastId = Math.max(lastId, id);
    read.push(`${slug}: ${found.map((a) => `${a.date} 12M ${a.m12 ?? "–"}`).join(", ") || "no yields"}`);
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  }
  const status = `ok, ${links.size} auction reports listed, ${read.length} read`;
  await save({ auctions, lastId, checkedAt: new Date().toISOString(), status });
  return { status, read, kept: auctions.length, latest: auctions[auctions.length - 1] ?? null };
}
