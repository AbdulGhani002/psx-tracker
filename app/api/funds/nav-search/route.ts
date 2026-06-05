import { NextRequest, NextResponse } from "next/server";
import { searchNavs } from "@/lib/funds/mufap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Live search of the MUFAP fund list. Used by the "add fund" form.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchNavs(q, 15);
  return NextResponse.json({ results });
}
