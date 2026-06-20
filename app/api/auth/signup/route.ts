import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { UserModel } from "@/lib/models";
import { hashPassword, randomToken } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/session";
import { sendEmail, appOrigin, verifyEmailHtml } from "@/lib/auth/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const email = String((body as any).email ?? "").toLowerCase().trim();
  const password = String((body as any).password ?? "");
  const name = String((body as any).name ?? "").trim();

  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  await connectDb();
  const existing = await UserModel.findOne({ email });
  if (existing) return NextResponse.json({ error: "An account with this email already exists. Try logging in." }, { status: 409 });

  const verifyTok = randomToken();
  const user = await UserModel.create({
    email,
    name,
    passwordHash: hashPassword(password),
    plan: "free",
    emailVerified: false,
    verifyToken: verifyTok,
    verifyTokenExp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastLoginAt: new Date(),
  });

  // Fire-and-forget verification email (no-op if RESEND_API_KEY isn't set).
  const link = `${appOrigin()}/verify?token=${verifyTok}`;
  sendEmail(email, "Confirm your email · PSX Portfolio", verifyEmailHtml(link)).catch(() => {});

  // Log the user in straight away (verification is not enforced for access).
  const token = await createSession(String(user._id), SESSION_MAX_AGE_SEC);
  const res = NextResponse.json({ ok: true });
  const proto = req.headers.get("x-forwarded-proto");
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: proto ? proto === "https" : true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
