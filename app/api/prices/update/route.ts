import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { cronAuthorised } from "@/lib/auth/cron";
import { updatePricesNow } from "@/lib/prices/manual";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// The Update prices button (components/layout/UpdatePrices): one update now
// (lib/prices/manual), for a signed-in user, or the server's own check.
export async function POST() {
  if (!(await getCurrentUserId()) && !(await cronAuthorised())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await updatePricesNow();
  return NextResponse.json(r, { status: r.ok ? 200 : 503 });
}
