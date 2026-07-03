import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

// Proxy to the chatbot-service (localhost:8200) — RAG over the platform's data
// with an instruct LLM. Behind the app's auth middleware like every /api route.
const CHATBOT_URL = process.env.CHATBOT_URL || "http://127.0.0.1:8200";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const res = await fetch(`${CHATBOT_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: String(body?.question ?? "").slice(0, 500) }),
      signal: AbortSignal.timeout(170000),
      cache: "no-store",
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "chatbot_unavailable" }, { status: 503 });
  }
}
