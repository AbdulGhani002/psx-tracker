import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uid } from "@/lib/auth/uid";
import { assembleTaxPack, buildTaxPackTex } from "@/lib/statement/tax-pack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TECTONIC = process.env.TECTONIC_BIN ?? "/usr/local/bin/tectonic";
const pExecFile = promisify(execFile);

// GET /api/export/tax-pack?year=2026 -> the filing pack as a PDF.
//
// ?format=tex returns the source instead, which is the escape hatch when
// tectonic is not installed (local development) and the useful thing to have
// when an accountant wants to edit it.
export async function GET(req: NextRequest) {
  if (!(await uid())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const yearParam = Number(req.nextUrl.searchParams.get("year"));
  const year = Number.isFinite(yearParam) && yearParam > 2000 ? yearParam : undefined;

  const data = await assembleTaxPack(year);
  const tex = buildTaxPackTex(data);
  const stamp = `psx-filing-pack-${data.fbrName.replace(/\s+/g, "-").toLowerCase()}`;

  if (req.nextUrl.searchParams.get("format") === "tex") {
    return new NextResponse(tex, {
      status: 200,
      headers: {
        "content-type": "application/x-tex; charset=utf-8",
        "content-disposition": `attachment; filename="${stamp}.tex"`,
        "cache-control": "no-store",
      },
    });
  }

  const dir = await mkdtemp(join(tmpdir(), "psx-taxpack-"));
  try {
    const texPath = join(dir, "pack.tex");
    await writeFile(texPath, tex, "utf8");
    await pExecFile(TECTONIC, ["--outdir", dir, texPath], { timeout: 240000 });
    const pdf = await readFile(join(dir, "pack.pdf"));
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${stamp}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // The pack itself is fine; only the typesetter failed. Hand back the source
    // rather than nothing, so the year's work is never trapped behind a missing
    // binary.
    return new NextResponse(tex, {
      status: 200,
      headers: {
        "content-type": "application/x-tex; charset=utf-8",
        "content-disposition": `attachment; filename="${stamp}.tex"`,
        "x-pdf-error": String(err).slice(0, 200).replace(/[^\x20-\x7e]/g, " "),
        "cache-control": "no-store",
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
