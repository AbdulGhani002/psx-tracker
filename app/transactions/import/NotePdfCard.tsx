"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type ImportRow = { symbol: string; type: string; date: string; shares: number; price: number; fees: number; notes: string };
type Confirmation = {
  side: "BUY" | "SELL";
  tradeDate: string;
  rows: Array<{ symbol: string; qty: number; marketRate: number }>;
  totalAmount: number | null;
  sst: number | null;
  grandTotal: number | null;
  problems: string[];
};
type ParseResult = { filename: string; confirmations?: Confirmation[]; importRows?: ImportRow[]; rawLines?: string[][]; error?: string };

function toCsv(rows: ImportRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    "symbol,type,date,shares,price,fees,notes",
    ...rows.map((r) => [r.symbol, r.type, r.date, r.shares, r.price, r.fees, esc(r.notes)].join(",")),
  ].join("\n");
}

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function NotePdfCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<ParseResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allRows = (results ?? []).flatMap((r) => r.importRows ?? []);
  const anyProblems = (results ?? []).some((r) => r.error || (r.confirmations ?? []).some((c) => c.problems.length > 0));

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    setImported(null);
    setResults(null);
    try {
      const form = new FormData();
      for (const f of Array.from(list)) form.append("files", f);
      const res = await fetch("/api/transactions/parse-note", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) { setError(d?.detail ?? d?.error ?? "Parse failed."); return; }
      setResults(d.results);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function doImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: toCsv(allRows), dryRun: false }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d?.detail ?? d?.error ?? "Import failed."); return; }
      setImported(`Imported ${d.imported} transactions. Holdings recomputed.`);
      setResults(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="label-cap">Upload BMA contract notes (.pdf)</div>
        <button onClick={() => fileRef.current?.click()} className="font-mono text-[10px] uppercase tracking-button hover:underline" style={{ color: "var(--accent-deep)" }} disabled={busy}>
          Choose PDFs
        </button>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </div>
      <p className="text-[13px] text-muted max-w-[64ch]">
        Every note is re-checked against its own arithmetic — each row&apos;s quantity × net rate, the note total, and total ± S.S.T against the grand
        total. If anything is off by more than 3 paisa the note is refused and shown raw, so a layout change can never import wrong numbers. Fees carry
        commission plus the S.S.T share; price is the market rate.
      </p>

      {busy && <div className="mt-3 text-[13px] text-muted">Parsing…</div>}
      {error && <div className="mt-3 text-[13px]" style={{ color: "var(--negative)" }}>{error}</div>}
      {imported && <div className="mt-3 text-[13px]" style={{ color: "var(--positive)" }}>{imported}</div>}

      {results?.map((r) => (
        <div key={r.filename} className="mt-4 border-t border-rule pt-3">
          <div className="font-mono text-[11px] uppercase tracking-stat text-muted">{r.filename}</div>
          {r.error && <div className="mt-1 text-[13px]" style={{ color: "var(--negative)" }}>{r.error}</div>}
          {(r.confirmations ?? []).map((c, i) => (
            <div key={i} className="mt-2">
              <div className="text-[13px]">
                <span className="font-medium">{c.side}</span> · trade date {c.tradeDate || "—"} · rows {fmt(c.totalAmount)} · S.S.T {fmt(c.sst)} · grand{" "}
                {fmt(c.grandTotal)}{" "}
                {c.problems.length === 0 ? (
                  <span style={{ color: "var(--positive)" }}>reconciles ✓</span>
                ) : (
                  <span style={{ color: "var(--negative)" }}>refused</span>
                )}
              </div>
              {c.problems.length > 0 && (
                <ul className="mt-1 text-[12px] list-disc pl-5" style={{ color: "var(--negative)" }}>
                  {c.problems.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {(r.confirmations?.length ?? 0) === 0 && !r.error && (
            <div className="mt-1 text-[13px]" style={{ color: "var(--negative)" }}>No BMA confirmation found in this PDF.</div>
          )}
          {r.rawLines && (
            <details className="mt-2">
              <summary className="font-mono text-[10px] uppercase tracking-button cursor-pointer text-muted">What the PDF actually says</summary>
              <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap border border-rule p-2 max-h-64 overflow-y-auto">
                {r.rawLines.map((p) => p.join("\n")).join("\n\n— page break —\n\n")}
              </pre>
            </details>
          )}
        </div>
      ))}

      {allRows.length > 0 && (
        <div className="mt-4 border-t border-rule pt-3">
          <div className="label-cap mb-2">{allRows.length} transactions ready</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono mono-num">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Date</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Symbol</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Type</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Shares</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Price</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Fees</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((row, i) => (
                  <tr key={i} className="border-b border-rule">
                    <td className="px-2 py-1.5">{row.date}</td>
                    <td className="px-2 py-1.5 font-medium">{row.symbol}</td>
                    <td className="px-2 py-1.5">{row.type}</td>
                    <td className="px-2 py-1.5 text-right">{row.shares}</td>
                    <td className="px-2 py-1.5 text-right">{row.price}</td>
                    <td className="px-2 py-1.5 text-right">{row.fees}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button variant="solid" onClick={doImport} disabled={busy || anyProblems}>
              Import {allRows.length}
            </Button>
            {anyProblems && <span className="text-[12px] text-muted">Fix or remove refused notes first — only clean notes import.</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
