// Position-aware PDF text extraction.
//
// Broker contract notes and fund statements are laid out in columns; flat text
// extraction scrambles them (unpdf's mergePages interleaves the columns and the
// numbers drift away from their rows). This reconstructs VISUAL LINES instead:
// cluster every text item by its y coordinate (3pt buckets), then sort each
// line's items by x — the same algorithm proven on these exact documents in
// preprocessing. Parsers downstream consume clean per-line strings.
import { getDocumentProxy } from "unpdf";

export async function extractLines(pdfBytes: Uint8Array): Promise<string[][]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const pages: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map<number, Array<{ x: number; s: string }>>();
    for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
      const s = (it.str ?? "").trim();
      if (!s || !it.transform) continue;
      const key = Math.round(it.transform[5] / 3);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({ x: it.transform[4], s });
    }
    pages.push(
      [...rows.entries()]
        .sort((a, b) => b[0] - a[0]) // PDF y grows upward → top of page first
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "))
    );
  }
  return pages;
}
