import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxy to the internal analytics-service (localhost:8100) so interactive client
// pages (the screener, comparison) can query it without it being exposed to the
// browser. Read-only GET passthrough; behind the app's auth middleware.
const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://127.0.0.1:8100";

export async function GET(req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  const path = (params.path || []).map(encodeURIComponent).join("/");
  const qs = req.nextUrl.search;
  try {
    const res = await fetch(`${ANALYTICS_URL}/${path}${qs}`, { cache: "no-store", signal: AbortSignal.timeout(9000) });
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "analytics_unavailable" }, { status: 503 });
  }
}
