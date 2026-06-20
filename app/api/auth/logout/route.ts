import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const proto = req.headers.get("x-forwarded-proto");
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: proto ? proto === "https" : true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
