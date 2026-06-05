import { NextRequest, NextResponse } from "next/server";
import { getCommodityRef } from "@/lib/commodities/refs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { symbol: string } }) {
  const ref = await getCommodityRef(params.symbol);
  if (!ref) return NextResponse.json({ error: "no_ref" }, { status: 404 });
  return NextResponse.json(ref);
}
