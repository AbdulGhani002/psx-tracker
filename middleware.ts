import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

// Constant-time string compare to defang timing attacks on credential check.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- Brute-force throttle (basic-auth path only) -----------------------------
// In-memory, per-instance failed-attempt counter keyed by client IP.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 20;
const LOCKOUT_MS = 15 * 60 * 1000;
type Bucket = { fails: number; first: number; blockedUntil: number };
const attempts = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Public paths: the auth screens and the auth endpoints themselves.
function isPublic(pathname: string): boolean {
  const pages = new Set(["/login", "/reset-password", "/verify"]);
  if (pages.has(pathname)) return true;
  return pathname.startsWith("/api/auth/");
}

export async function middleware(req: NextRequest) {
  const expectedUser = process.env.AUTH_USERNAME ?? "";
  const expectedPass = process.env.AUTH_PASSWORD ?? "";

  // Auth is opt-in. If no password is set (e.g. local dev), let everything through.
  if (!expectedPass) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // 1) Cookie session — the human path (login page sets a signed 30-day cookie).
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token)) return NextResponse.next();

  // 2) HTTP Basic header — machine callers only (the systemd cron timers curl
  //    with -u). Silent: we never send WWW-Authenticate, so no browser popup.
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("basic ")) {
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = attempts.get(ip);
    if (bucket && now - bucket.first > WINDOW_MS && now > bucket.blockedUntil) {
      attempts.delete(ip);
      bucket = undefined;
    }
    if (!(bucket && bucket.blockedUntil > now)) {
      try {
        const decoded = atob(header.slice(6).trim());
        const i = decoded.indexOf(":");
        if (i >= 0 && safeEqual(decoded.slice(0, i), expectedUser) && safeEqual(decoded.slice(i + 1), expectedPass)) {
          attempts.delete(ip);
          return NextResponse.next();
        }
      } catch {
        /* malformed header → treat as failure below */
      }
      const b = attempts.get(ip) ?? { fails: 0, first: now, blockedUntil: 0 };
      b.fails += 1;
      if (b.fails >= MAX_FAILS) b.blockedUntil = now + LOCKOUT_MS;
      attempts.set(ip, b);
    }
  }

  // 3) Unauthenticated. API callers get a clean 401; humans get the login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Build the redirect from the FORWARDED host/proto. Behind nginx, the Next
  // standalone server's req.nextUrl reflects its internal listen address
  // (localhost:8012), not the public domain — so redirecting to nextUrl bounces
  // the browser to localhost. The Host header (set by nginx) has the real domain.
  const nextParam = encodeURIComponent(pathname + (req.nextUrl.search || ""));
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) {
    return NextResponse.redirect(`${proto}://${host}/login?next=${nextParam}`);
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `next=${nextParam}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static icons. Includes /api/*.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
