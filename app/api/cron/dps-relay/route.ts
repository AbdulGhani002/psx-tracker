import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { FeedSnapshotModel, HoldingModel, BuyListModel } from "@/lib/models";
import { keepRelayedPages, dpsResting } from "@/lib/prices/dps";
import { qualityUniverse, lastRead, readCompanies } from "@/lib/fundamentals/refresh";
import { SHEET_PREFIX, pktToday } from "@/lib/quant/sheet-bars";
import { refreshCloses } from "@/lib/quant/daily";
import { INDEX_SERIES } from "@/lib/quant/index-bars";
import { refreshIndexForecasts } from "@/lib/index-week/data";
import type { DayRow } from "@/lib/timeseries/psx-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

// Machine-only. The server asks the exchange's site itself first; when the
// site refuses it (it has closed every data request from the server's address
// since 9 Oct 2026), the home machine, which is served as before, fetches for
// it (scripts/dps-push.ts) and hands over here.
//   {plan:true, max?}: what to fetch: the weekdays after the last closing file
//   kept, the index pages, and the company pages most wanted (every held one,
//   then those read longest ago).
//   {sheets, pages}: the closing files, kept as the server keeps its own; the
//   pages, read by the server's fetchers when the site refuses them
//   (lib/prices/dps.ts); then the evening chain on them: prices and index
//   series, the indexes' levels (lib/index-week), and the company figures of
//   the pages handed over. {run:false} only keeps them.
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
    // Held names first, then the buy list's (their letters say a dividend
    // before the ex-date), then the rest, read longest ago first.
    const held = [...new Set([...((await HoldingModel.find({ currentShares: { $gt: 0 } }, { symbol: 1 }).lean()) as any[]).map((h) => String(h.symbol)), ...((await BuyListModel.distinct("symbol", {})) as string[])])];
    const rest = all.filter((s) => !held.includes(s)).sort((a, b) => (read.get(a) ?? 0) - (read.get(b) ?? 0));
    return NextResponse.json({
      today: pktToday(),
      latestKept: latest ? String(latest.key).slice(SHEET_PREFIX.length) : null,
      indices: ["/indices", ...INDEX_SERIES.map((c) => `/indices/${c}`)],
      symbols: [...held, ...rest].slice(0, Math.max(max, held.length)),
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
  const out: Record<string, unknown> = { sheets: keptSheets, pages: keptPages };
  if (body?.run === false) return NextResponse.json({ ok: true, ...out });

  // The evening chain, on what was handed over.
  const { sheets: ingest, bars, indices } = await refreshCloses();
  const latest = bars.latest ?? ingest.latest;
  const forecasts = await refreshIndexForecasts().catch(() => null);
  const companies = Object.keys(pages).filter((p) => p.startsWith("/company/")).map((p) => decodeURIComponent(p.slice("/company/".length)));
  const report = companies.length ? await readCompanies(companies, { lite: true }) : {};
  const readOk = Object.values(report).filter((v) => /years/.test(v)).length;
  return NextResponse.json({
    ok: true,
    seconds: Math.round((Date.now() - t0) / 1000),
    ...out,
    bars: { latest, series: bars.series, appended: bars.appended, adjusted: bars.adjusted.length },
    indices: indices.map((i) => `${i.code} ${i.to ?? i.note ?? ""}`),
    forecasts: forecasts ? { asOf: forecasts.asOf, indexes: forecasts.indexes.length } : null,
    companies: { read: readOk, of: companies.length },
  });
}
