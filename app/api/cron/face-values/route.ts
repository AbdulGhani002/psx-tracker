import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { checkFaceValues, fixAutoDividends } from "@/lib/corporate-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: every company's face value from the cash dividends the
// closing files show, and the dividends the job wrote at a rate those do not
// bear out. Body {dryRun:true} only reports.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const faces = await checkFaceValues({ dryRun });
  const dividends = await fixAutoDividends({ dryRun });
  return NextResponse.json({ ok: true, dryRun, faces, dividends });
}
