import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { UserModel } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const token = String((body as any).token ?? "");
  if (!token) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  await connectDb();
  const user = await UserModel.findOne({ verifyToken: token, verifyTokenExp: { $gt: new Date() } });
  if (!user) return NextResponse.json({ error: "This verification link is invalid or has expired." }, { status: 400 });
  user.emailVerified = true;
  user.verifyToken = "";
  user.verifyTokenExp = null;
  await user.save();
  return NextResponse.json({ ok: true });
}
