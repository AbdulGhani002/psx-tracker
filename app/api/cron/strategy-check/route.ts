import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds, getSbpRateSteps, getTbill12mPct } from "@/lib/data";
import { getStrategy, getRatesPrefill } from "@/lib/strategy/data";

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
  return NextResponse.json({ ok: true, policyRate, chartDays: s.chart.length, kse: s.kse, book: s.book, profile: s.profile, rates: s.rates, prefillSources: prefill.sources, entered: prefill.entered, steps: s.plan.steps, tranches: s.plan.tranches, parking: s.plan.parking.options.map((o) => `${o.label} ${o.yieldPct.toFixed(2)}%${o.best ? " *" : ""}`), quality: { reconsider: s.plan.quality.reconsider.map((n) => n.symbol), income: s.plan.quality.income.map((n) => n.symbol) } });
}
