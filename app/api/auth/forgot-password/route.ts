import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { UserModel } from "@/lib/models";
import { randomToken } from "@/lib/auth/password";
import { sendEmail, appOrigin, resetEmailHtml } from "@/lib/auth/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const email = String((body as any).email ?? "").toLowerCase().trim();
  await connectDb();
  const user = email ? await UserModel.findOne({ email }) : null;
  if (user) {
    const tok = randomToken();
    user.resetToken = tok;
    user.resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save().catch(() => {});
    const link = `${appOrigin()}/reset-password?token=${tok}`;
    await sendEmail(email, "Reset your password · PSX Portfolio", resetEmailHtml(link)).catch(() => {});
  }
  // Always succeed — never reveal whether an email is registered.
  return NextResponse.json({ ok: true });
}
