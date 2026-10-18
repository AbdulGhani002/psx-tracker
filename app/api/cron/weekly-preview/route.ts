import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDb } from "@/lib/db";
import { getAllUserIds } from "@/lib/data";
import { runAsUser } from "@/lib/auth/current-user";
import { cronAuthorised } from "@/lib/auth/cron";
import { assembleWeeklyReport, buildWeeklyTex, weeklySummaryText } from "@/lib/statement/weekly";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TECTONIC = process.env.TECTONIC_BIN ?? "/usr/local/bin/tectonic";
const pExecFile = promisify(execFile);

// Machine-only: one user's weekly plan as it would go out, sent nowhere and
// logged nowhere. Body {user: n, pdf: true} returns the PDF, otherwise the
// summary text and the figures behind it.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const data = await runAsUser(uid, () => assembleWeeklyReport());
  if (body?.pdf !== true) {
    return NextResponse.json({ ok: true, summary: weeklySummaryText(data), ladderAction: data.ladderAction, ladderLine: data.ladderLine, gateLine: data.gateLine, poolCutLine: data.poolCutLine, cashPlaces: data.cashPlaces, cashLocked: data.cashLocked, rungs: data.rungs, steps: data.strategy?.steps ?? [], signals: data.signals.map((s) => `${s.label} ${s.source} ${s.known ? s.score : "-"} ${s.reading}`) });
  }
  const dir = await mkdtemp(join(tmpdir(), "psx-weekly-preview-"));
  try {
    const texPath = join(dir, "weekly.tex");
    await writeFile(texPath, buildWeeklyTex(data), "utf8");
    await pExecFile(TECTONIC, ["--outdir", dir, texPath], { timeout: 240000 });
    const pdf = await readFile(join(dir, "weekly.pdf"));
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
