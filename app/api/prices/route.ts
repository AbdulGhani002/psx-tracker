import { NextRequest, NextResponse } from "next/server";
import { getPrices, refreshPrice } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "symbols= required" }, { status: 400 });
  }
  try {
    const prices = await getPrices(symbols);
    return NextResponse.json({
      prices: Object.fromEntries(prices),
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const symbol = String(body?.symbol ?? "").trim();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
  const q = await refreshPrice(symbol);
  if (!q) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(q);
}
