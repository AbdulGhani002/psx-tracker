import { NextRequest, NextResponse } from "next/server";
import { getAllTransactions, getSbpRateSteps, getSavingsValued, getMutualFundsValued, getCashEntries } from "@/lib/data";
import { buildBenchmarkSeries } from "@/lib/timeseries/portfolio-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const rangeKey = req.nextUrl.searchParams.get("range") ?? "90D";
  const [txs, { steps }, savings, funds, cashEntries] = await Promise.all([
    getAllTransactions(),
    getSbpRateSteps(),
    getSavingsValued().catch(() => []),
    getMutualFundsValued().catch(() => []),
    getCashEntries().catch(() => []),
  ]);
  const netWorthExtras = {
    savings: (savings as any[]).map((a) => ({ ratePercent: a.ratePercent, anchorDate: a.anchorDate, anchorBalance: a.anchorBalance, movements: a.movements ?? [] })),
    fundsNow: (funds as any[]).reduce((s, f) => s + (f.value ?? 0), 0),
    commoditiesNow: 0, // matches the app's net-worth definition (equity+funds+savings+cash)
    cashEntries: (cashEntries as any[]).map((e) => ({ date: e.date, type: e.type, amount: e.amount })),
  };
  const series = await buildBenchmarkSeries({ transactions: txs, rangeKey, rateSteps: steps, netWorthExtras });
  if (!series) {
    return NextResponse.json({ error: "no_data" }, { status: 404 });
  }
  return NextResponse.json(series);
}
