import { NextRequest, NextResponse } from "next/server";
import { extractLines } from "@/lib/pdf/pos-text";
import { parseBmaNote, toImportRows } from "@/lib/brokers/bma-note";
import { parseGenericNote, genericToImportRows } from "@/lib/brokers/generic-note";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Preview-only: parses contract-note PDFs into import rows. Nothing is written
// here — the client feeds the rows through /api/transactions/import (dry-run
// first), so every gate on that path still applies.
//
// Two parsers, tried in order. The BMA one knows that layout exactly and
// reconciles it to the paisa. When it recognises nothing, the generic parser
// looks instead for the arithmetic any contract note must contain: rows whose
// quantity times rate equals their amount, adding up to the total printed on
// the note. It is less precise and says so on every row it produces, but it
// turns "we do not support your broker" into "check these figures against your
// note" — and it still refuses outright rather than importing numbers that do
// not add up.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files");
  if (files.length === 0) return NextResponse.json({ error: "no_files" }, { status: 400 });
  if (files.length > 10) return NextResponse.json({ error: "too_many_files", detail: "Max 10 PDFs per upload." }, { status: 400 });

  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  const results: Array<{
    filename: string;
    parser?: "bma" | "generic";
    confirmations?: ReturnType<typeof parseBmaNote>;
    generic?: ReturnType<typeof parseGenericNote>;
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

      if (confirmations.length > 0) {
        const importRows = confirmations.flatMap((c) => toImportRows(c));
        // When nothing imported (or a note failed its gates), return the
        // extracted lines so the user can see exactly what the PDF said and why
        // we refused.
        const anyProblem = confirmations.some((c) => c.problems.length > 0);
        results.push({ filename: f.name, parser: "bma", confirmations, importRows, ...(anyProblem ? { rawLines: pages } : {}) });
        continue;
      }

      const generic = parseGenericNote(pages);
      const importRows = genericToImportRows(generic);
      // The raw lines are always attached for a generic parse, whether it
      // succeeded or not: these figures were inferred from arithmetic rather
      // than from a known layout, so they should always be checkable.
      const { rawLines, ...withoutLines } = generic;
      results.push({ filename: f.name, parser: "generic", generic: withoutLines as typeof generic, importRows, rawLines: pages });
    } catch (err) {
      results.push({ filename: f.name, error: String(err) });
    }
  }
  return NextResponse.json({ results });
}
