import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { ValuationAssumptionModel } from "@/lib/models";
import { approveVersion } from "@/lib/valuation/run";

export const dynamic = "force-dynamic";

// A waiting draft: approve it (the version before superseded, the share
// valued again) or reject it.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const body: any = await req.json().catch(() => ({}));
  await connectDb();
  const userId = await uid();
  if (body?.action === "approve") {
    const ok = await approveVersion(userId, id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (body?.action === "reject") {
    const r = await ValuationAssumptionModel.updateOne({ _id: id, userId, status: "draft" }, { $set: { status: "rejected" } });
    return r.matchedCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
}
