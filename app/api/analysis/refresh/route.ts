import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { uid } from "@/lib/auth/uid";
import { startRebuild, rebuildStatus } from "@/lib/quant/rebuild";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST starts a rebuild of the logged-in user's analysis and returns at
// once; GET says how it is going. The build itself runs in the background
// (lib/quant/rebuild.ts) because it outlasts the proxy's request limit.
// Middleware already blocks callers without a session; the sentinel check
// is the belt to that brace.
export async function POST() {
  const userId = await uid();
  if (!userId || userId === "__no_user__") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  await connectDb();
  const { started, job } = startRebuild(userId);
  return NextResponse.json({ ok: true, started, startedAt: job.startedAt }, { status: started ? 202 : 200 });
}

export async function GET() {
  const userId = await uid();
  if (!userId || userId === "__no_user__") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const job = rebuildStatus(userId);
  return NextResponse.json({ ok: true, running: !!job && !job.done, job });
}
