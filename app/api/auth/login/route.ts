import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { UserModel } from "@/lib/models";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, verifySession, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/auth/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory brute-force throttle, per client IP (single-node deployment).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 12;
const LOCKOUT_MS = 15 * 60 * 1000;
type Bucket = { fails: number; first: number; blockedUntil: number };
const attempts = new Map<string, Bucket>();

// Trust X-Real-IP: nginx sets it from $remote_addr, so a client can't forge it.
// X-Forwarded-For is APPENDED to by nginx ($proxy_add_x_forwarded_for), so its
// FIRST entry is whatever the caller sent — reading that let an attacker reset
// their own throttle bucket just by rotating the header. If we must fall back to
// XFF, take the LAST hop (the one nginx appended).
function clientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}
function cookieSecure(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  return proto ? proto === "https" : true;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = attempts.get(ip);
  if (bucket && now - bucket.first > WINDOW_MS && now > bucket.blockedUntil) {
    attempts.delete(ip);
    bucket = undefined;
  }
  if (bucket && bucket.blockedUntil > now) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(Math.ceil((bucket.blockedUntil - now) / 1000)) } });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  // Bot check (no-op unless TURNSTILE_SECRET_KEY is set). Done before the
  // password check so it doesn't burn a brute-force attempt.
  if (!(await verifyTurnstile(String((body as any).turnstileToken ?? ""), ip))) {
    return NextResponse.json({ error: "Bot check failed. Please try again." }, { status: 403 });
  }
  // Accept `email` (new) or `username` (legacy form field).
  const email = String((body as any).email ?? (body as any).username ?? "").toLowerCase().trim();
  const password = String((body as any).password ?? "");
  const remember = (body as any).remember !== false;

  const fail = () => {
    const b = attempts.get(ip) ?? { fails: 0, first: now, blockedUntil: 0 };
    b.fails += 1;
    if (b.fails >= MAX_FAILS) b.blockedUntil = now + LOCKOUT_MS;
    attempts.set(ip, b);
  };

  await connectDb();
  const user = await UserModel.findOne({ email });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    fail();
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  attempts.delete(ip);
  user.lastLoginAt = new Date();
  await user.save().catch(() => {});

  const maxAge = remember ? SESSION_MAX_AGE_SEC : 12 * 60 * 60;
  const token = await createSession(String(user._id), maxAge);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: SESSION_MAX_AGE_SEC } : {}),
  });
  return res;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  return NextResponse.json({ authenticated: !!session });
}
