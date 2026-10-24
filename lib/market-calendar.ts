import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, MarketEventModel } from "@/lib/models";
import { getTbillAuctions } from "@/lib/feeds/tbill-auctions";
import { htmlText } from "@/lib/feeds/tbill-parse";
import { auctionEvents, mergeEvents, mpcFromHeadline, mpcFromSchedule, ruleEvents, type CalEvent } from "@/lib/calculations/market-calendar";

// The market's dates, filled by the app (lib/calculations/market-calendar):
// the rule dates worked out, T-bill auctions from the last one kept, and the
// dates only an announcement gives (MPC days, PSX holidays, the FOMC, the
// IMF) kept in MarketEvent. MPC days are caught from Mettis Global's
// headlines ("SBP to announce monetary policy on ...") and from SBP's yearly
// schedule when it is reported, every six hours with the T-bill reports.

const RULE_KINDS = new Set(["expiry", "cpi", "results", "index", "auction"]);
const MPC_KEY = "mpc:mettis";
const EVERY_MS = 6 * 3600_000;
const LISTS = ["https://mettisglobal.news/Economy", "https://mettisglobal.news/Fixedincome"];
const BASE = "https://mettisglobal.news/";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export async function marketHolidays(): Promise<Set<string>> {
  await connectDb();
  return new Set(((await MarketEventModel.find({ kind: "holiday", about: { $ne: true } }, { date: 1 }).lean()) as any[]).map((e) => String(e.date)));
}

export async function marketEvents(from: string, to: string): Promise<CalEvent[]> {
  await connectDb();
  const rows = (await MarketEventModel.find({ date: { $gte: from, $lte: to } }).sort({ createdAt: 1 }).lean()) as any[];
  const seen = new Set<string>();
  const announced: CalEvent[] = [];
  for (const r of rows) {
    if (RULE_KINDS.has(r.kind)) continue;
    const k = `${r.date}|${r.kind}`;
    if (r.kind === "mpc" && seen.has(k)) continue;
    seen.add(k);
    announced.push({ date: String(r.date), title: String(r.title), kind: String(r.kind), about: !!r.about, source: String(r.source ?? "") });
  }
  const holidays = await marketHolidays();
  const auctions = await getTbillAuctions().catch(() => []);
  const last = auctions.length ? auctions[auctions.length - 1].date : null;
  return mergeEvents(announced, [...ruleEvents(from, to, holidays), ...auctionEvents(last, from, to)]);
}

async function get(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(20000) }).catch(() => null);
  return res && res.ok ? await res.text().catch(() => null) : null;
}

// MPC days from the headlines, and a reported yearly schedule, into
// MarketEvent. Every six hours unless forced.
export async function refreshMpcDates(force = false): Promise<Record<string, unknown>> {
  await connectDb();
  const kept: any = await FeedSnapshotModel.findOne({ key: MPC_KEY }).lean();
  if (!force && kept?.data?.checkedAt && Date.now() - Date.parse(kept.data.checkedAt) < EVERY_MS) return { status: "fresh" };
  const today = pkToday();
  const seen = new Set<string>(kept?.data?.seen ?? []);
  const found: string[] = [];
  for (const list of LISTS) {
    const page = await get(list);
    if (!page) continue;
    for (const m of page.matchAll(/href=["'](?:https:\/\/mettisglobal\.news)?\/([A-Za-z0-9-]+-(\d{4,7}))["']/g)) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      const headline = slug.replace(/-\d{4,7}$/, "");
      const one = mpcFromHeadline(headline, today);
      if (one) {
        await MarketEventModel.updateOne({ date: one, title: "MPC decision" }, { $set: { kind: "mpc", about: false, source: `Mettis: ${headline.slice(0, 120)}`, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
        found.push(`${one} (${headline})`);
        seen.add(slug);
        continue;
      }
      if (/(mpc|monetary.policy)/i.test(headline) && /(schedule|calendar)/i.test(headline)) {
        const html = await get(BASE + slug);
        const dates = html ? mpcFromSchedule(htmlText(html), today) : [];
        for (const d of dates) await MarketEventModel.updateOne({ date: d, title: "MPC meeting" }, { $set: { kind: "mpc", about: false, source: `Mettis schedule: ${headline.slice(0, 100)}`, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
        if (dates.length) found.push(`schedule: ${dates.join(", ")}`);
        seen.add(slug);
      }
    }
  }
  await FeedSnapshotModel.updateOne({ key: MPC_KEY }, { $set: { key: MPC_KEY, data: { checkedAt: new Date().toISOString(), seen: [...seen].slice(-300) }, status: "ok", note: found.join("; ").slice(0, 300) || "none new", updatedAt: new Date() } }, { upsert: true });
  return { status: "ok", found };
}
