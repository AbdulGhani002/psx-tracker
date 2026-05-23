import { NextRequest, NextResponse } from "next/server";
import { getAllTransactions } from "@/lib/data";
import { buildBenchmarkSeries } from "@/lib/timeseries/portfolio-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? "90");
  const txs = await getAllTransactions();
  const series = await buildBenchmarkSeries({ transactions: txs, days });
  if (!series) {
    return NextResponse.json({ error: "no_data" }, { status: 404 });
  }
  return NextResponse.json(series);
}
