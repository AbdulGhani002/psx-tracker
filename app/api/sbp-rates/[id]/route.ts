import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { SbpRateModel } from "@/lib/models";
import { uid } from "@/lib/auth/uid";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDb();
  // Scope by userId, not id alone: an unscoped findByIdAndDelete let any account
  // delete another user's policy-rate step just by guessing the id.
  const doc = await SbpRateModel.findOneAndDelete({ _id: params.id, userId: await uid() }).lean();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
