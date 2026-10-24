import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { getMarketStudies } from "@/lib/market-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

// Machine-only: the KSE-100's monthly history and the studies on it
// (lib/market-history). Body {rebuild:true} builds the history again.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  const s = await getMarketStudies(body?.rebuild === true);
  return NextResponse.json({ ok: true, ...s });
}
