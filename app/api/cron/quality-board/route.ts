import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getAppSettings, getPortfolioSummary, getSbpRateSteps } from "@/lib/data";
import { getQualityBoard } from "@/lib/fundamentals/board";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's quality board in brief, to check the figures from
// the server (the page itself needs a signed-in session). One user a call,
// body {user: n}, the nth account (0 by default).
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  // How long each part takes, the viewer's own first (prices, settings).
  const timed = async <T,>(f: () => Promise<T>) => { const t = Date.now(); await f().catch(() => null); return Date.now() - t; };
  const parts = await runAsUser(uid, async () => ({ summary: await timed(getPortfolioSummary), settings: await timed(getAppSettings), sbp: await timed(getSbpRateSteps) }));
  const t0 = Date.now();
  const b = await runAsUser(uid, () => getQualityBoard());
  const r1 = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  const brief = (p: any) =>
    p && { pe: r1(p.pe), cape: r1(p.cape), pb: r1(p.pb, 2), roe: r1(p.roePct), dy: r1(p.dividendYieldPct), eps: r1(p.epsCagrPct), implied: r1(p.impliedReturnPct), margin: r1(p.netMarginPct), cover: p.coverage, quadrants: p.quadrants, grades: p.grades };
  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    parts,
    users: ids.length,
    costOfEquityPct: b.costOfEquityPct,
    marketMedianCape: r1(b.marketMedianCape),
    cpiPeriod: b.cpiPeriod,
    counts: b.counts,
    portfolio: brief(b.portfolio),
    market: brief(b.market),
    held: b.rows
      .filter((x) => x.held)
      .map((x) => ({ s: x.symbol, w: r1(x.weightPct), g: x.q.grade, quad: x.q.quadrant, pe: r1(x.q.pe), cape: r1(x.q.cape), pb: r1(x.q.pb, 2), jpb: r1(x.q.justifiedPb, 2), roe: r1(x.q.roePct), dy: r1(x.q.dividendYieldPct), implied: r1(x.q.impliedReturnPct), book: x.q.bookSource, bs: x.balance ? `${x.balance.periodEnd} ${x.balance.consolidated ? "group" : "standalone"} ${x.balance.method}` : null, notes: x.q.notes })),
    compounders: b.rows.filter((x) => !x.held && x.q.quadrant === "compounder" && (x.q.grade === "A" || x.q.grade === "B")).slice(0, 12).map((x) => `${x.symbol} ${x.q.grade} ROE ${r1(x.q.roePct)} CAPE ${r1(x.q.cape)}`),
  });
}
