import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runValuationsAll, draftPlan, storeDrafts } from "@/lib/valuation/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Machine-only. {run:true} values every user's approved shares on the latest
// close; {plan:true} returns what the home machine works its drafts from;
// {drafts:[...]} keeps the drafts it sends. In the normal course the home
// machine's evening job (scripts/dps-push.ts) does all three through
// /api/cron/dps-relay.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  if (body?.plan === true) return NextResponse.json({ items: await draftPlan() });
  const out: Record<string, unknown> = {};
  if (Array.isArray(body?.drafts)) out.drafts = await storeDrafts(body.drafts);
  if (body?.run === true) out.runs = await runValuationsAll();
  return NextResponse.json({ ok: true, ...out });
}
