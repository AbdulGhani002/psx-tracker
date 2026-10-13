import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { ValuationTriggerModel } from "@/lib/models";

export const dynamic = "force-dynamic";

// Turn a trigger on or off, or remove it.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const body: any = await req.json().catch(() => ({}));
  if (typeof body?.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
  await connectDb();
  const r = await ValuationTriggerModel.updateOne({ _id: id, userId: await uid() }, { $set: { active: body.active } });
  return r.matchedCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  await connectDb();
  const r = await ValuationTriggerModel.deleteOne({ _id: id, userId: await uid() });
  return r.deletedCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
