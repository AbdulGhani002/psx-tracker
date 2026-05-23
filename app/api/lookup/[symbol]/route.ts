import { NextRequest, NextResponse } from "next/server";
import { getCompanyInfo, refreshPrice } from "@/lib/prices";

export const dynamic = "force-dynamic";

// Fast lookup used by the transaction form to preview "what does PSX know about
// this ticker?" before the user commits the transaction.
export async function GET(_req: NextRequest, { params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const info = await getCompanyInfo(symbol);
  const quote = await refreshPrice(symbol);
  if (!info && !quote) {
    return NextResponse.json({ error: "not_found", symbol }, { status: 404 });
  }
  return NextResponse.json({
    symbol,
    name: info?.name ?? symbol,
    sector: info?.sector ?? "Unknown",
    price: quote?.price ?? null,
    asOf: quote?.asOf ?? null,
  });
}
