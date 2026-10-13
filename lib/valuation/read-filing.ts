// On the home machine only (scripts/dps-push.ts): a results filing read by the
// model running there under Ollama. The cover letter's own text gives the
// period and the dividend (lib/prices/results.ts). Each statement page goes
// to the model, as its text where it has one and as a picture of the page
// where it has none (scripts/render-pages.py renders it whole, the right way
// up; without Python, the largest picture in it), and the model copies what
// the page prints; the figures are settled and checked in
// lib/valuation/figures.ts. With no model running, the text alone is read,
// and a scanned filing gives nothing but its letter.
//   OLLAMA_URL (http://127.0.0.1:11434), VALUATION_MODEL (qwen3.5:9b), PYTHON (python)

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { extractImages, getDocumentProxy } from "unpdf";
import { extractLines } from "@/lib/pdf/pos-text";
import { parseResultFigures, type ResultFigures } from "@/lib/prices/results";
import { settleFigures, basisOf, type PageRead } from "./figures";

const OLLAMA = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.VALUATION_MODEL || "qwen3.5:9b";
const MAX_PAGES = 16;
const STATEMENT = /profit\s+(or|and)\s+loss|income\s+statement|financial\s+position|balance\s+sheet/i;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    unitText: { type: "string" },
    statement: { type: "string", enum: ["profit or loss", "financial position", "other"] },
    periodEnd: { type: "string" },
    periodMonths: { type: "integer", enum: [0, 3, 6, 9, 12] },
    netProfit: { type: ["number", "null"] },
    netProfitPrior: { type: ["number", "null"] },
    eps: { type: ["number", "null"] },
    epsPrior: { type: ["number", "null"] },
    totalAssets: { type: ["number", "null"] },
    totalEquity: { type: ["number", "null"] },
    revaluationSurplus: { type: ["number", "null"] },
    shareCapital: { type: ["number", "null"] },
  },
  required: ["title", "unitText", "statement", "periodEnd", "periodMonths", "netProfit", "netProfitPrior", "eps", "epsPrior", "totalAssets", "totalEquity", "revaluationSurplus", "shareCapital"],
};

const PROMPT = `This is one page of a Pakistani listed company's financial results. Copy what it prints; do not work anything out.
- title: the statement's heading exactly as printed, with its period line (e.g. "UNCONSOLIDATED STATEMENT OF PROFIT OR LOSS FOR THE YEAR ENDED JUNE 30, 2026"); "" if none.
- unitText: the unit line above the figures exactly as printed (e.g. "(Rupees in '000)"); "" if none.
- statement: "profit or loss" for a statement of profit or loss or income statement, "financial position" for a statement of financial position or balance sheet, else "other".
- periodEnd: the end of the current period, yyyy-mm-dd; "" if none. periodMonths: its length (12 for a year); where a page has both quarter and cumulative columns, the cumulative.
- netProfit and netProfitPrior: profit or loss after tax for the period, attributable to the owners where split, current period and the comparative period. Brackets mean negative.
- eps and epsPrior: basic earnings per share, the total line (not "from continuing operations"), current and comparative.
- totalAssets: total assets at the current date.
- totalEquity: the company's own equity at the current date: its "Total equity" line, or where there is none, the subtotal of share capital and reserves. Never "total equity and liabilities", which equals total assets.
- revaluationSurplus: the surplus on revaluation of property, plant and equipment (or of fixed assets) at the current date, where the page prints one.
- shareCapital: issued, subscribed and paid-up capital at the current date.
Use the cumulative columns where a page has both. Numbers as printed without commas. null for anything the page does not print.`;

async function ask(content: string, image: string | null): Promise<Omit<PageRead, "page" | "source"> | null> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: "2m",
      format: SCHEMA,
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: "user", content, ...(image ? { images: [image] } : {}) }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) return null;
  const j: any = await res.json();
  try {
    return JSON.parse(j?.message?.content ?? "");
  } catch {
    return null;
  }
}

export async function modelReady(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const j: any = await res.json();
    return (j?.models ?? []).some((m: any) => m.name === MODEL || m.model === MODEL);
  } catch {
    return false;
  }
}

// Whole pages as JPEGs, from PyMuPDF; null where Python or it is missing.
function renderPages(bytes: Uint8Array, pages: number[]): Map<number, string> | null {
  if (!pages.length) return new Map();
  const dir = mkdtempSync(join(tmpdir(), "psx-filing-"));
  try {
    const file = join(dir, "filing.pdf");
    writeFileSync(file, bytes);
    const r = spawnSync(process.env.PYTHON || "python", ["-I", join(process.cwd(), "scripts", "render-pages.py"), file, pages.join(",")], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 180_000 });
    if (r.status !== 0) return null;
    const out = new Map<number, string>();
    for (const line of r.stdout.split("\n")) {
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      out.set(j.page, j.jpg);
    }
    return out;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The largest picture on a page, as a JPEG the model can take.
async function pageImage(pdf: any, n: number): Promise<string | null> {
  const imgs = await extractImages(pdf, n).catch(() => []);
  const big = imgs.filter((im: any) => Math.max(im.width, im.height) >= 1000).sort((a: any, b: any) => b.width * b.height - a.width * a.height)[0];
  if (!big) return null;
  const jpg = await sharp(Buffer.from(big.data), { raw: { width: big.width, height: big.height, channels: big.channels } })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return jpg.toString("base64");
}

export async function readFiling(bytes: Uint8Array, ctx: Parameters<typeof settleFigures>[1], log: (s: string) => void = () => {}): Promise<ResultFigures> {
  const lines = await extractLines(bytes.slice());
  const letter = parseResultFigures(lines);
  if (!(await modelReady())) return { ...letter, source: "text", checks: [`The model (${MODEL}) is not running here: the text alone was read.`] };

  const pdf = await getDocumentProxy(bytes.slice());
  const last = Math.min(pdf.numPages, MAX_PAGES);
  const textOf = (n: number) => (lines[n - 1] ?? []).join("\n");
  const scanned = Array.from({ length: last }, (_, k) => k + 1).filter((n) => textOf(n).replace(/\s/g, "").length <= 200);
  const rendered = renderPages(bytes, scanned);
  const reads: PageRead[] = [];
  const t0 = Date.now();
  for (let n = 1; n <= last; n++) {
    const text = textOf(n);
    let got: Omit<PageRead, "page" | "source"> | null = null;
    let source: PageRead["source"] = "text";
    if (text.replace(/\s/g, "").length > 200) {
      if (!STATEMENT.test(text)) continue;
      got = await ask(`${PROMPT}\n\nThe page's text:\n${text.slice(0, 12000)}`, null).catch(() => null);
    } else {
      const image = rendered?.get(n) ?? (await pageImage(pdf, n));
      if (!image) continue;
      source = "image";
      got = await ask(PROMPT, image).catch(() => null);
    }
    if (!got) continue;
    reads.push({ ...got, page: n, source });
    // Done once the company's own profit and book are both in.
    const own = reads.filter((r) => basisOf(r.title) !== "consolidated");
    if (own.some((r) => r.statement === "profit or loss" && r.eps != null) && own.some((r) => r.statement === "financial position" && r.totalEquity != null)) break;
  }
  log(`  read ${reads.length} statement pages in ${Math.round((Date.now() - t0) / 1000)}s`);
  const s = settleFigures(reads, ctx);
  return {
    period: s.period ?? letter.period,
    periodEnd: s.periodEnd ?? letter.periodEnd,
    eps: s.eps ?? null,
    epsPrior: s.epsPrior ?? null,
    profit: s.profit ?? null,
    equity: s.equity ?? null,
    revaluation: s.revaluation ?? null,
    basis: s.basis,
    dps: letter.dps,
    text: letter.text || reads.length > 0,
    source: "model",
    checks: s.checks,
  };
}
