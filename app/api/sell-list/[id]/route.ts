import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { SellListModel } from "@/lib/models";

export const dynamic = "force-dynamic";

// Takes a share off the sell list.
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await connectDb();
  const r = await SellListModel.deleteOne({ _id: id, userId: await uid() });
  return r.deletedCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
