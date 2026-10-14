import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllTransactions } from "@/lib/data";
import { recordsCsv, recordsTex, selectRecords, totalsOf, type RecordKind, type RecordTx } from "@/lib/export/records";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pExecFile = promisify(execFile);
const TECTONIC = process.env.TECTONIC_BIN ?? "/usr/local/bin/tectonic";

// GET /api/export/records?from=&to=&kind=trades|dividends|all&symbol=&actions=1&format=csv|pdf|json
// Trades and dividends of the portfolio chosen in the app, for a period or
// all time. json is the export page's count and totals.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const kind: RecordKind = q.get("kind") === "dividends" ? "dividends" : q.get("kind") === "all" ? "all" : "trades";
  const sel = { from: date(q.get("from")), to: date(q.get("to")), kind, symbol: (q.get("symbol") ?? "").trim().toUpperCase() || null, actions: q.get("actions") === "1" };
  const format = q.get("format") ?? "csv";

  const txs: RecordTx[] = (await getAllTransactions()).map((t: any) => ({
    date: new Date(t.date).toISOString().slice(0, 10),
    type: String(t.type),
    symbol: String(t.symbol),
    shares: Number(t.shares) || 0,
    pricePerShare: Number(t.pricePerShare) || 0,
    totalAmount: Number(t.totalAmount) || 0,
    fees: Number(t.fees) || 0,
    netAmount: Number(t.netAmount) || 0,
    taxDeducted: Number(t.taxDeducted) || 0,
    zakatDeducted: Number(t.zakatDeducted) || 0,
    warrantNo: t.warrantNo ? String(t.warrantNo) : "",
    notes: String(t.notes ?? ""),
    ratio: String(t.ratio ?? ""),
  }));
  const rows = selectRecords(txs, sel);
  const totals = totalsOf(rows);
  if (format === "json") return NextResponse.json({ totals, first: rows[0]?.date ?? null, last: rows[rows.length - 1]?.date ?? null });

  const what = kind === "trades" ? "Trades" : kind === "dividends" ? "Dividends" : "Trades and dividends";
  const title = `${what}${sel.symbol ? `: ${sel.symbol}` : ""}`;
  const period = sel.from || sel.to ? `${sel.from ?? "the first record"} to ${sel.to ?? "today"}` : "All time";
  const stamp = `${kind}${sel.symbol ? `-${sel.symbol}` : ""}-${sel.from ?? "start"}-to-${sel.to ?? "today"}`;

  if (format !== "pdf") {
    return new NextResponse(recordsCsv(rows, totals, `${title}, ${period}`), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${stamp}.csv"`, "cache-control": "no-store" },
    });
  }

  const tex = recordsTex(rows, totals, { title, period, generatedOn: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10) });
  const dir = await mkdtemp(join(tmpdir(), "psx-records-"));
  try {
    const texPath = join(dir, "records.tex");
    await writeFile(texPath, tex, "utf8");
    await pExecFile(TECTONIC, ["--outdir", dir, texPath], { timeout: 240000 });
    const pdf = await readFile(join(dir, "records.pdf"));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${stamp}.pdf"`, "cache-control": "no-store" },
    });
  } catch (err) {
    // The typesetter failed, not the records: hand back the source.
    return new NextResponse(tex, {
      headers: { "content-type": "application/x-tex; charset=utf-8", "content-disposition": `attachment; filename="${stamp}.tex"`, "x-pdf-error": String(err).slice(0, 200).replace(/[^\x20-\x7e]/g, " "), "cache-control": "no-store" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
