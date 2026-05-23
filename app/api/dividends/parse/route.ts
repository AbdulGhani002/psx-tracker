import { NextRequest, NextResponse } from "next/server";
import { parseWarrantPdf } from "@/lib/dividends/parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Accepts multipart/form-data with one or more "files" entries.
// Returns a JSON array of parsed-warrant results, one per uploaded PDF.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files");
  if (files.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 400 });
  }

  const results: Array<{ filename: string; parsed?: unknown; error?: string }> = [];
  for (const f of files) {
    if (!(f instanceof File)) {
      results.push({ filename: "(unknown)", error: "not_a_file" });
      continue;
    }
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      results.push({ filename: f.name, error: "not_pdf" });
      continue;
    }
    try {
      const buffer = Buffer.from(await f.arrayBuffer());
      const parsed = await parseWarrantPdf(buffer);
      // Don't ship the full raw text to the client — too big and noisy.
      const { raw, ...rest } = parsed;
      results.push({ filename: f.name, parsed: rest });
    } catch (err) {
      results.push({ filename: f.name, error: String(err) });
    }
  }
  return NextResponse.json({ results });
}
