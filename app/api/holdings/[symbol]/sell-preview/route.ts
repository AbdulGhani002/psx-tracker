import { NextRequest, NextResponse } from "next/server";
import { getTransactionsBySymbol, getAppSettings } from "@/lib/data";
import { buildLots, previewSell } from "@/lib/calculations/lots";

export const dynamic = "force-dynamic";

// Preview the CGT of a hypothetical sell, matched FIFO against open lots.
export async function GET(req: NextRequest, props: { params: Promise<{ symbol: string }> }) {
  const params = await props.params;
  const symbol = params.symbol.toUpperCase();
  const shares = Number(req.nextUrl.searchParams.get("shares") ?? "0");
  const price = Number(req.nextUrl.searchParams.get("price") ?? "0");
  if (!(shares > 0) || !(price > 0)) {
    return NextResponse.json({ error: "shares and price required" }, { status: 400 });
  }
  const [txs, settings] = await Promise.all([getTransactionsBySymbol(symbol), getAppSettings()]);
  const { openLots } = buildLots(symbol, txs);
  const rate = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const preview = previewSell(openLots, shares, price, rate);
  return NextResponse.json({ ...preview, rate, sharesHeld: openLots.reduce((s, l) => s + l.shares, 0) });
}
