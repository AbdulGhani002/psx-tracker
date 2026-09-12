import { NextRequest, NextResponse } from "next/server";
import { PORTFOLIO_COOKIE, ALL, listPortfolios } from "@/lib/portfolios";
import { getCurrentUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

// Sets which portfolio the pages show: a portfolio id, or "all".
export async function POST(req: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? ALL);
  if (id !== ALL) {
    const all = await listPortfolios();
    if (!all.some((p) => p._id === id)) return NextResponse.json({ error: "no such portfolio" }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true, selected: id });
  res.cookies.set(PORTFOLIO_COOKIE, id, { path: "/", httpOnly: false, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
