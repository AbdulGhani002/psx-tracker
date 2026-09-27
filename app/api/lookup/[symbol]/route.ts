import { NextRequest, NextResponse } from "next/server";
import { fetchPSXPage } from "@/lib/prices/scraper";

export const dynamic = "force-dynamic";

// One direct scrape of dps.psx.com.pk — no Mongo, no cache — used by the
// transaction form to preview "what does PSX know about this ticker?" before
// the user commits. Caching happens once a real transaction is saved.
export async function GET(_req: NextRequest, props: { params: Promise<{ symbol: string }> }) {
  const params = await props.params;
  const symbol = params.symbol.toUpperCase();
  const snap = await fetchPSXPage(symbol);
  if (!snap || (!snap.name && snap.price == null)) {
    return NextResponse.json({ error: "not_found", symbol }, { status: 404 });
  }
  return NextResponse.json({
    symbol,
    name: snap.name ?? symbol,
    sector: snap.sector ?? "Unknown",
    price: snap.price,
    asOf: snap.asOf,
  });
}
