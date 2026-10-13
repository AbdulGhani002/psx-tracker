import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, HoldingModel } from "@/lib/models";
import { getAllUserIds } from "@/lib/data";
import { keepRelayedPages, dpsResting } from "@/lib/prices/dps";
import { qualityUniverse, lastRead, readCompanies } from "@/lib/fundamentals/refresh";
import { SHEET_PREFIX, pktToday } from "@/lib/quant/sheet-bars";
import { refreshCloses, rebuildUser, rebuiltThrough } from "@/lib/quant/daily";
import { INDEX_SERIES } from "@/lib/quant/index-bars";
import { refreshMacroLive } from "@/lib/macro/live";
import { draftPlan, storeDrafts, runValuationsAll } from "@/lib/valuation/run";
import type { DayRow } from "@/lib/timeseries/psx-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

// Machine-only. Since 9 Oct 2026 the exchange's site closes every data request
// from the server's address; the home machine is served as before, so it
// fetches for the server (scripts/dps-push.ts) and hands over here.
//   {plan:true, max?}: what to fetch: the weekdays after the last closing file
//   kept, the index pages, and the company pages most wanted (every held one
//   and every one valued, then the watched shares never read, then those read
//   longest ago); and, for every share a user holds or values, what its
//   valuation draft is worked out from (lib/valuation/draft.ts): the home
//   machine reads any new results filing itself.
//   {sheets, pages, drafts}: the closing files, kept as the server keeps its
//   own; the pages, read by the server's fetchers in place of the site
//   (lib/prices/dps.ts); the drafts, kept for the owners to review; then the
//   evening chain on them: prices, the dividend record, each user's reading,
//   the strategy model, the company figures of the pages handed over, and
//   the valuations. {run:false} only keeps them.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const t0 = Date.now();

  if (body?.plan === true) {
    const max = Math.max(1, Math.min(80, Number(body?.max ?? 25)));
    const latest: any = await FeedSnapshotModel.findOne({ key: { $regex: "^" + SHEET_PREFIX } }, { key: 1 }).sort({ key: -1 }).lean();
    const all = await qualityUniverse();
    const read = await lastRead(all);
    const held = ((await HoldingModel.find({ currentShares: { $gt: 0 } }, { symbol: 1 }).lean()) as any[]).map((h) => String(h.symbol));
    const valuation = await draftPlan().catch(() => []);
    const valued = [...new Set(valuation.map((v) => v.symbol))];
    const first = [...new Set([...held, ...valued])];
    const rest = all.filter((s) => !first.includes(s)).sort((a, b) => (read.get(a) ?? 0) - (read.get(b) ?? 0));
    return NextResponse.json({
      today: pktToday(),
      latestKept: latest ? String(latest.key).slice(SHEET_PREFIX.length) : null,
      indices: ["/indices", ...INDEX_SERIES.map((c) => `/indices/${c}`)],
      symbols: [...first, ...rest].slice(0, Math.max(max, first.length)),
      valuation,
      resting: await dpsResting(),
    });
  }

  const sheets = (Array.isArray(body?.sheets) ? body.sheets : []) as Array<{ date: string; rows: DayRow[] }>;
  let keptSheets = 0;
  for (const s of sheets) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s?.date)) || !Array.isArray(s.rows) || s.rows.length < 50) continue;
    await FeedSnapshotModel.findOneAndUpdate(
      { key: SHEET_PREFIX + s.date },
      { key: SHEET_PREFIX + s.date, data: { date: s.date, rows: s.rows }, status: "ok", note: `${s.rows.length} names (handed over by the home machine)`, updatedAt: new Date() },
      { upsert: true }
    );
    keptSheets++;
  }
  const pages = (body?.pages && typeof body.pages === "object" ? body.pages : {}) as Record<string, { html: string; fetchedAt: string }>;
  const keptPages = await keepRelayedPages(pages);
  const keptDrafts = Array.isArray(body?.drafts) ? await storeDrafts(body.drafts).catch(() => 0) : 0;
  const out: Record<string, unknown> = { sheets: keptSheets, pages: keptPages, drafts: keptDrafts };
  if (body?.run === false) return NextResponse.json({ ok: true, ...out });

  // The evening chain, on what was handed over.
  const { sheets: ingest, bars, indices } = await refreshCloses();
  const latest = bars.latest ?? ingest.latest;
  const users: Array<Record<string, unknown>> = [];
  for (const id of await getAllUserIds()) {
    const done = await rebuiltThrough(id);
    if (done && latest && done >= latest) continue;
    try {
      users.push({ user: id.slice(-6), ...(await rebuildUser(id, latest)) });
    } catch (e) {
      users.push({ user: id.slice(-6), error: String(e instanceof Error ? e.message : e).slice(0, 160) });
    }
  }
  const live = bars.appended > 0 || keptSheets > 0 ? await refreshMacroLive().catch(() => null) : null;
  const companies = Object.keys(pages).filter((p) => p.startsWith("/company/")).map((p) => decodeURIComponent(p.slice("/company/".length)));
  const report = companies.length ? await readCompanies(companies, { lite: true }) : {};
  const readOk = Object.values(report).filter((v) => /years/.test(v)).length;
  const valuations = await runValuationsAll().catch(() => []);
  return NextResponse.json({
    ok: true,
    seconds: Math.round((Date.now() - t0) / 1000),
    ...out,
    bars: { latest, series: bars.series, appended: bars.appended, events: bars.events, adjusted: bars.adjusted.length },
    indices: indices.map((i) => `${i.code} ${i.to ?? i.note ?? ""}`),
    users,
    macroLive: live ? { asOf: live.asOf, shares: live.names.length } : null,
    companies: { read: readOk, of: companies.length },
    valuations: valuations.map((v) => ({ user: v.user, date: v.date, valued: v.valued, changes: v.changes.length, fired: v.fired.length })),
  });
}
