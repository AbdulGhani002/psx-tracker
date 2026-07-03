import { NextRequest, NextResponse } from "next/server";
import { getTransactionsBySymbol, getCurrentPrices, getAppSettings } from "@/lib/data";
import { buildLots, previewSell } from "@/lib/calculations/lots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// What-if CGT: which FIFO lots a hypothetical sale would consume and the exact
// tax outcome, using the user's own filer status and rates.
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") || "").toUpperCase().trim();
  const shares = Number(req.nextUrl.searchParams.get("shares") || 0);
  const priceParam = Number(req.nextUrl.searchParams.get("price") || 0);
  if (!symbol || !Number.isFinite(shares) || shares <= 0) {
    return NextResponse.json({ error: "symbol and a positive shares count are required" }, { status: 400 });
  }
  const [txs, settings, prices] = await Promise.all([
    getTransactionsBySymbol(symbol),
    getAppSettings(),
    getCurrentPrices([symbol]),
  ]);
  const { openLots } = buildLots(symbol, txs);
  const held = openLots.reduce((s, l) => s + l.shares, 0);
  const price = priceParam > 0 ? priceParam : prices.get(symbol) ?? 0;
  if (price <= 0) return NextResponse.json({ error: "no current price for this symbol" }, { status: 422 });
  const rate = settings.filerStatus === "filer" ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const preview = previewSell(openLots, shares, price, rate);
  return NextResponse.json({
    symbol,
    price,
    rate,
    filerStatus: settings.filerStatus,
    held,
    proceeds: shares * price,
    netAfterTax: shares * price - preview.estCgt,
    ...preview,
  });
}
