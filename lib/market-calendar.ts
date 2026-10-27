import "server-only";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, MarketEventModel } from "@/lib/models";
import { getTbillAuctions } from "@/lib/feeds/tbill-auctions";
import { htmlText } from "@/lib/feeds/tbill-parse";
import { auctionEvents, chartDecisions, mergeEvents, missedMpc, mpcFromHeadline, mpcFromSchedule, policyDecisionFrom, policyDecisionHeadline, ruleEvents, type CalEvent } from "@/lib/calculations/market-calendar";
import { keepPolicyStep } from "@/lib/market-history";

// The market's dates, filled by the app (lib/calculations/market-calendar):
// the rule dates worked out, T-bill auctions from the last one kept, and the
// dates only an announcement gives (MPC days, PSX holidays, the FOMC, the
// IMF) kept in MarketEvent. MPC days are caught from Mettis Global's
// headlines ("SBP to announce monetary policy on ...") and from SBP's yearly
// schedule when it is reported, every six hours with the T-bill reports
// (hourly on an MPC day and the day after). The decision itself comes from
// the site's policy-rate chart (a rate a meeting month, dated by the MPC day
// kept) and from the headline that reports it ("SBP hikes policy rate by
// 0.5% to 12%", its article read); the new rate is kept with SBP's history
// (lib/market-history).

const RULE_KINDS = new Set(["expiry", "cpi", "results", "index", "auction"]);
const MPC_KEY = "mpc:mettis";
const EVERY_MS = 6 * 3600_000;
const MPC_DAY_MS = 3600_000;
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
// MarketEvent; a decision into the policy-rate history. Every six hours
// unless forced, hourly on an MPC day and the day after.
export async function refreshMpcDates(force = false): Promise<Record<string, unknown>> {
  await connectDb();
  const kept: any = await FeedSnapshotModel.findOne({ key: MPC_KEY }).lean();
  const today = pkToday();
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const near = await MarketEventModel.exists({ kind: "mpc", about: { $ne: true }, date: { $gte: yesterday, $lte: today } });
  if (!force && kept?.data?.checkedAt && Date.now() - Date.parse(kept.data.checkedAt) < (near ? MPC_DAY_MS : EVERY_MS)) return { status: "fresh" };
  const seen = new Set<string>(kept?.data?.seen ?? []);
  const decisions: Array<{ decided: string; rate: number; move: string }> = kept?.data?.decisions ?? [];
  const found: string[] = [];
  // The policy rate as Mettis charts it, a row a meeting month: kept after
  // the headline has left the lists, so no decision is missed for that.
  const chart = await get(BASE + "Home/PPrateChart");
  if (chart) {
    let rows: unknown = [];
    try {
      rows = JSON.parse(chart);
    } catch {
      /* not the chart */
    }
    const days = ((await MarketEventModel.find({ kind: "mpc", about: { $ne: true } }, { date: 1, title: 1 }).lean()) as any[]).filter((e) => /^MPC\b/.test(String(e.title)) && !/minutes/i.test(String(e.title))).map((e) => String(e.date));
    for (const d of chartDecisions(Array.isArray(rows) ? rows : [], days, today)) {
      if (!decisions.some((x) => x.decided === d.decided)) decisions.push({ decided: d.decided, rate: d.rate, move: d.move });
      const r = await keepPolicyStep(d, "Mettis policy-rate chart");
      if (r === "kept") found.push(`policy ${d.rate}% from ${d.from} (chart)`);
    }
  }
  for (const list of LISTS) {
    const page = await get(list);
    if (!page) continue;
    for (const m of page.matchAll(/href=["'](?:https:\/\/mettisglobal\.news)?\/([A-Za-z0-9-]+-(\d{4,7}))["']/g)) {
      const slug = m[1];
      if (seen.has(slug)) continue;
      const headline = slug.replace(/-\d{4,7}$/, "");
      if (policyDecisionHeadline(headline)) {
        const html = await get(BASE + slug);
        if (!html) continue;
        const title = html.match(/"headline"\s*:\s*"([^"]+)"/)?.[1] ?? headline.replace(/-/g, " ");
        const d = policyDecisionFrom(title, htmlText(html), html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ?? null);
        if (d) {
          found.push(`policy ${d.rate}% from ${d.from}: ${await keepPolicyStep(d, `Mettis: ${title.slice(0, 120)}`)}`);
          decisions.push({ decided: d.decided, rate: d.rate, move: d.move });
        }
        seen.add(slug);
        continue;
      }
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
  await FeedSnapshotModel.updateOne({ key: MPC_KEY }, { $set: { key: MPC_KEY, data: { checkedAt: new Date().toISOString(), seen: [...seen].slice(-300), decisions: decisions.slice(-24) }, status: "ok", note: found.join("; ").slice(0, 300) || "none new", updatedAt: new Date() } }, { upsert: true });
  return { status: "ok", found };
}

// An MPC day gone by with no decision read (lib/calculations/market-calendar
// missedMpc): the reader may have missed it.
export async function missedDecision(today: string): Promise<string | null> {
  await connectDb();
  const from = new Date(Date.parse(today + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const days = ((await MarketEventModel.find({ kind: "mpc", about: { $ne: true }, date: { $gte: from, $lt: today } }, { date: 1, title: 1 }).lean()) as any[])
    .filter((e) => /^MPC\b/.test(String(e.title)) && !/minutes/i.test(String(e.title)))
    .map((e) => String(e.date));
  const kept: any = await FeedSnapshotModel.findOne({ key: MPC_KEY }).lean();
  return missedMpc(days, ((kept?.data?.decisions ?? []) as any[]).map((x) => String(x.decided)), today);
}
