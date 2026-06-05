import { NextRequest, NextResponse } from "next/server";
import { getAllTransactions, getSbpRateSteps } from "@/lib/data";
import { buildBenchmarkSeries } from "@/lib/timeseries/portfolio-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const rangeKey = req.nextUrl.searchParams.get("range") ?? "90D";
  const [txs, { steps }] = await Promise.all([getAllTransactions(), getSbpRateSteps()]);
  const series = await buildBenchmarkSeries({ transactions: txs, rangeKey, rateSteps: steps });
  if (!series) {
    return NextResponse.json({ error: "no_data" }, { status: 404 });
  }
  return NextResponse.json(series);
}
