import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { UserModel } from "@/lib/models";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const token = String((body as any).token ?? "");
  const password = String((body as any).password ?? "");
  if (!token) return NextResponse.json({ error: "Invalid reset link." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  await connectDb();
  const user = await UserModel.findOne({ resetToken: token, resetTokenExp: { $gt: new Date() } });
  if (!user) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });

  user.passwordHash = hashPassword(password);
  user.resetToken = "";
  user.resetTokenExp = null;
  await user.save();
  return NextResponse.json({ ok: true });
}
