import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { qualityUniverse, lastRead, readCompanies } from "@/lib/fundamentals/refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

// Machine-only, daily (psx-quality.timer): company pages for the quality and
// price figures (lib/fundamentals/refresh.ts), for the KSE-100, every name
// held and every share of a watched sector. A run reads the `max` names
// checked longest ago (20 by default; never-read names first), so the whole
// universe turns over in a couple of weeks and a run stays short; pages the
// home machine pushed are used first (lib/prices/dps.ts). Body
// {symbols:[...]} reads just those; {reread:true} reads the newest report's
// balance sheet even if it was read before (after a fix to the statement
// reader); {lite:true} reads only the pages never read, without payouts or
// the balance sheet.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const max = Math.max(1, Math.min(150, Number(body?.max ?? 20)));
  const reread = body?.reread === true;
  const lite = body?.lite === true;
  const t0 = Date.now();

  let symbols: string[] = Array.isArray(body?.symbols) ? body.symbols.map((s: string) => String(s).toUpperCase()) : [];
  if (symbols.length === 0) {
    const all = await qualityUniverse();
    const checked = await lastRead(all);
    symbols = lite ? all.filter((s) => !checked.get(s)).slice(0, max) : all.sort((a, b) => (checked.get(a) ?? 0) - (checked.get(b) ?? 0)).slice(0, max);
  }
  const report = await readCompanies(symbols, { lite, reread });
  return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - t0) / 1000), refreshed: symbols.length, report });
}
