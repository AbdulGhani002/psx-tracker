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

export function middleware(req: NextRequest) {
  const expectedUser = process.env.AUTH_USERNAME ?? "";
  const expectedPass = process.env.AUTH_PASSWORD ?? "";

  // Auth is opt-in. If no password is set (e.g. local dev), let everything through.
  if (!expectedPass) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return unauthorised();

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorised();
  }

  const colon = decoded.indexOf(":");
  if (colon < 0) return unauthorised();
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);

  if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
    return unauthorised();
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and the favicon. Includes /api/*.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)"],
};
