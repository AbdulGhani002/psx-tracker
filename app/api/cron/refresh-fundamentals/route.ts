import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { HoldingModel, FundamentalModel } from "@/lib/models";
import { fetchFundamentals } from "@/lib/prices/fundamentals";
import { fetchPayouts } from "@/lib/prices/payouts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Proactively refresh EPS/financials + dividend payouts for every held symbol,
// so the forecast / valuation / look-through pages always have fresh data
// (otherwise they refetch lazily on view, which is slow). Run weekly by a timer.
export async function POST() {
  // Machine-only: a logged-in session must not reach this. See lib/auth/cron.ts.
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const holdings = await HoldingModel.find({ currentShares: { $gt: 0 } }).lean();
  const symbols = [...new Set(holdings.map((h: any) => h.symbol))];
  const report: Record<string, string> = {};
  let ok = 0;

  for (const s of symbols) {
    try {
      const [fund, payouts] = await Promise.all([fetchFundamentals(s), fetchPayouts(s)]);
      if (!fund && !payouts) {
        report[s] = "no data";
        continue;
      }
      const prev: any = await FundamentalModel.findOne({ symbol: s }).lean();
      await FundamentalModel.findOneAndUpdate(
        { symbol: s },
        {
          symbol: s,
          faceValue: fund?.faceValue ?? prev?.faceValue ?? 10,
          sector: fund?.sector || prev?.sector || "",
          annual: fund?.annual ?? prev?.annual ?? [],
          latestEps: fund?.latestEps ?? prev?.latestEps ?? null,
          epsGrowthPct: fund?.epsGrowthPct ?? prev?.epsGrowthPct ?? null,
          payouts:
            payouts != null
              ? payouts.map((p) => ({ date: p.announceDate ?? p.bookClosureStart, bookClosure: p.bookClosureStart, pctOfFace: p.pctOfFace, cycle: p.cycle, payoutType: p.payoutType }))
              : prev?.payouts ?? [],
          source: fund?.source ?? "psx-dps",
          fetchedAt: new Date(),
        },
        { upsert: true }
      );
      report[s] = `eps=${fund?.latestEps ?? "?"} payouts=${payouts?.length ?? 0}`;
      ok++;
    } catch (e) {
      report[s] = `error: ${String(e).slice(0, 120)}`;
    }
    // Be polite to PSX between symbols.
    await new Promise((r) => setTimeout(r, 800));
  }

  return NextResponse.json({ ok: true, refreshed: ok, total: symbols.length, report });
}
