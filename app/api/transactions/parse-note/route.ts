import { NextRequest, NextResponse } from "next/server";
import { extractLines } from "@/lib/pdf/pos-text";
import { parseBmaNote, toImportRows } from "@/lib/brokers/bma-note";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Preview-only: parses BMA contract-note PDFs into import rows. Nothing is
// written here — the client feeds the rows through /api/transactions/import
// (dry-run first), so every gate on that path still applies.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files");
  if (files.length === 0) return NextResponse.json({ error: "no_files" }, { status: 400 });
  if (files.length > 10) return NextResponse.json({ error: "too_many_files", detail: "Max 10 PDFs per upload." }, { status: 400 });

  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  const results: Array<{
    filename: string;
    confirmations?: ReturnType<typeof parseBmaNote>;
    importRows?: ReturnType<typeof toImportRows>;
    rawLines?: string[][];
    error?: string;
  }> = [];

  for (const f of files) {
    if (!(f instanceof File)) { results.push({ filename: "(unknown)", error: "not_a_file" }); continue; }
    if (!f.name.toLowerCase().endsWith(".pdf")) { results.push({ filename: f.name, error: "not_pdf" }); continue; }
    if (f.size > MAX_PDF_BYTES) { results.push({ filename: f.name, error: "file_too_large" }); continue; }
    try {
      const pages = await extractLines(new Uint8Array(await f.arrayBuffer()));
      const confirmations = parseBmaNote(pages);
      const importRows = confirmations.flatMap((c) => toImportRows(c));
      // When nothing parsed (or a note failed its gates), return the extracted
      // lines so the user can see exactly what the PDF said and why we refused.
      const anyProblem = confirmations.length === 0 || confirmations.some((c) => c.problems.length > 0);
      results.push({ filename: f.name, confirmations, importRows, ...(anyProblem ? { rawLines: pages } : {}) });
    } catch (err) {
      results.push({ filename: f.name, error: String(err) });
    }
  }
  return NextResponse.json({ results });
}
