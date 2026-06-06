import { NextRequest, NextResponse } from "next/server";

// Constant-time string compare to defang timing attacks on credential check.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorised() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="PSX Portfolio", charset="UTF-8"',
    },
  });
}

// --- Brute-force throttle ----------------------------------------------------
// In-memory, per-instance failed-attempt counter keyed by client IP. Good enough
// for a single-node deployment: an attacker who fat-fingers (or scripts) the
// password gets locked out after MAX_FAILS within WINDOW_MS.
const WINDOW_MS = 15 * 60 * 1000; // 15 min sliding window
const MAX_FAILS = 10; // attempts allowed per window before lockout
const LOCKOUT_MS = 15 * 60 * 1000; // how long a tripped IP stays blocked
type Bucket = { fails: number; first: number; blockedUntil: number };
const attempts = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function tooManyRequests(retryAfterSec: number) {
  return new NextResponse("Too many failed attempts. Try again later.", {
    status: 429,
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec))) },
  });
}

export function middleware(req: NextRequest) {
  const expectedUser = process.env.AUTH_USERNAME ?? "";
  const expectedPass = process.env.AUTH_PASSWORD ?? "";

  // Auth is opt-in. If no password is set (e.g. local dev), let everything through.
  if (!expectedPass) return NextResponse.next();

  const ip = clientIp(req);
  const now = Date.now();
  let bucket = attempts.get(ip);
  // Reset an expired window.
  if (bucket && now - bucket.first > WINDOW_MS && now > bucket.blockedUntil) {
    attempts.delete(ip);
    bucket = undefined;
  }
  // Currently locked out.
  if (bucket && bucket.blockedUntil > now) {
    return tooManyRequests((bucket.blockedUntil - now) / 1000);
  }

  const fail = () => {
    const b = attempts.get(ip) ?? { fails: 0, first: now, blockedUntil: 0 };
    b.fails += 1;
    if (b.fails >= MAX_FAILS) b.blockedUntil = now + LOCKOUT_MS;
    attempts.set(ip, b);
    // Opportunistic prune so the map can't grow unbounded.
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) {
        if (now - v.first > WINDOW_MS && now > v.blockedUntil) attempts.delete(k);
      }
    }
  };

  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return unauthorised();

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    fail();
    return unauthorised();
  }

  const colon = decoded.indexOf(":");
  if (colon < 0) {
    fail();
    return unauthorised();
  }
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);

  if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
    fail();
    return unauthorised();
  }

  // Success — clear any accumulated failures for this IP.
  if (bucket) attempts.delete(ip);
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and the favicon. Includes /api/*.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
