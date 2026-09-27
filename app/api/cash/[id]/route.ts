import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { CashEntryModel } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await connectDb();
  const doc = await CashEntryModel.findOneAndDelete({ _id: params.id, userId: await uid() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
