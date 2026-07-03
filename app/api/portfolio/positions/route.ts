import { NextResponse } from "next/server";
import { getPortfolioSummary } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Current equity positions for client-side tools (the optimizer's "apply this
// mix" panel). Auth-protected by the middleware like every /api route.
export async function GET() {
  const summary = await getPortfolioSummary();
  const positions = summary.positions
    .filter((p) => p.shares > 0)
    .map((p) => ({ symbol: p.symbol, shares: p.shares, price: p.currentPrice, marketValue: p.marketValue }));
  return NextResponse.json({ totalValue: summary.totalValue, positions });
}
