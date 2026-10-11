import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getSbpRateSteps, getTbill12mPct } from "@/lib/data";
import { getStrategy, getRatesPrefill, type Research, type ResearchRow } from "@/lib/strategy/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: one user's strategy as the page shows it, to check from the
// server (the page needs a signed-in session). Body {user: n}.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const [s, prefill, steps, tbill12m] = await runAsUser(uid, () => Promise.all([getStrategy(), getRatesPrefill(), getSbpRateSteps(), getTbill12mPct()]));
  const policyRate = { source: steps.source, asOf: steps.liveAsOf, pct: steps.steps[0]?.rate ?? null, tbill12mPct: tbill12m };
  return NextResponse.json({ ok: true, policyRate, model: s.model ? { date: s.model.date, state: s.model.state, names: Object.keys(s.model.names).length } : null, chartDays: s.chart.length, kse: s.kse, book: s.book, profile: s.profile, rates: s.rates, prefillSources: prefill.sources, entered: prefill.entered, steps: s.plan.steps, tranches: s.plan.tranches, parking: s.plan.parking.options.map((o) => `${o.label} ${o.yieldPct.toFixed(2)}%${o.best ? " *" : ""}`), quality: { add: s.plan.quality.add.map((n) => n.symbol), reconsider: s.plan.quality.reconsider.map((n) => n.symbol), income: s.plan.quality.income.map((n) => n.symbol) }, research: researchSummary(s.research), macro: s.macro ? { asOf: s.macro.asOf, computedAt: s.macro.computedAt, rate: s.macro.rate, trainedTo: s.macro.model.trainedTo, ic: s.macro.model.record.ic, topSectors: s.macro.sectors.slice(0, 5).map((x) => `${x.name} ${x.pctile.toFixed(2)}`), learning: { tenths: s.macro.learning.calibration.map((c) => Math.round(c.rel3 * 1000) / 10), live: s.macro.learning.live, value: s.macro.learning.value } } : null });
}

// The research in brief: each ticked sector's calls, the buy list and the
// holdings' calls, with the figures behind each.
function researchSummary(r: Research) {
  const brief = (x: ResearchRow) => ({ s: x.symbol, px: x.price, rank: x.pctile == null ? null : Math.round(x.pctile * 100) / 100, edge: x.edge == null ? null : Math.round(x.edge * 1000) / 10, yld: x.dividendYieldPct, thin: x.thin, pe: x.pe == null ? null : Math.round(x.pe * 10) / 10, usual: x.fairPe == null ? null : Math.round(x.fairPe * 10) / 10, buy: x.buy.verdict, at: x.buy.buyAt, sell: x.sell?.verdict, sellAt: x.sell?.sellAt, zone: x.zone ? `${x.zone.buyLow}-${x.zone.buyHigh}/${x.zone.sellLow}-${x.zone.sellHigh}` : null });
  return {
    asOf: r.asOf,
    rateNow: r.rateNow,
    watched: r.watched,
    sectors: r.sectors.map((x) => ({ name: x.name, rank: x.rank, pctile: x.pctile, peNow: x.peNow, peFair: x.peFair, shares: x.rows.length, quiet: x.quiet, calls: x.rows.reduce((m, y) => ({ ...m, [y.buy.verdict]: (m[y.buy.verdict] ?? 0) + 1 }), {} as Record<string, number>) })),
    buys: r.buys.map(brief),
    held: r.held.map(brief),
    withPe: r.sectors.flatMap((x) => x.rows).filter((x) => x.pe != null).length,
    withUsual: r.sectors.flatMap((x) => x.rows).filter((x) => x.fairPe != null).length,
  };
}
