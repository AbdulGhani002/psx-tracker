import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { CashEntryModel } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  const doc = await CashEntryModel.findByIdAndDelete(params.id).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
