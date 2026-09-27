import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { connectDb } from "@/lib/db";
import { parseMufap } from "@/lib/funds/mufap";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { cronAuthorised } from "@/lib/auth/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MUFAP_NAVS_KEY = "mufapNavs";

// MUFAP blocks datacentre IPs but serves browsers fine — so a scheduled task
// on the user's own machine fetches the fund-price page and relays the RAW
// HTML here (gzipped; ~38 KB). The server parses it with the same parser the
// direct fetch path uses — one parser, no client-side maths to trust. Machine
// auth only; never regresses a newer snapshot.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { htmlGz?: string; at?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (!body.htmlGz) return NextResponse.json({ error: "missing_htmlGz" }, { status: 400 });

  let html: string;
  try {
    html = gunzipSync(Buffer.from(body.htmlGz, "base64")).toString("utf8");
  } catch {
    return NextResponse.json({ error: "gunzip_failed" }, { status: 400 });
  }

  const navs = parseMufap(html);
  // A tiny or empty parse means MUFAP changed layout or served an error page —
  // refuse rather than clobber the good snapshot with garbage.
  if (navs.length < 50) {
    return NextResponse.json({ error: "parse_too_small", parsed: navs.length, detail: "refusing to overwrite the stored snapshot" }, { status: 422 });
  }
  const bad = navs.filter((n) => !Number.isFinite(n.nav) || n.nav <= 0).length;
  if (bad > 0) {
    return NextResponse.json({ error: "invalid_navs", count: bad }, { status: 422 });
  }

  const at = body.at && /^\d{4}-\d{2}-\d{2}$/.test(body.at) ? body.at : new Date().toISOString().slice(0, 10);

  await connectDb();
  const existing = await getFeedSnapshot<{ at: string }>(MUFAP_NAVS_KEY);
  if (existing.data?.at && existing.data.at > at) {
    return NextResponse.json({ ok: true, skipped: "existing snapshot is newer", existingAt: existing.data.at });
  }
  await saveFeedSnapshot(MUFAP_NAVS_KEY, { at, navs }, "ok", `home relay ${at}, ${navs.length} funds`);
  return NextResponse.json({ ok: true, funds: navs.length, at });
}
