"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type Preview = {
  preview: Array<{ symbol: string; type: string; date: string; shares: number; pricePerShare: number; fees: number; notes: string }>;
  total: number;
  errors: Array<{ line: number; reason: string }>;
};

const SAMPLE = `symbol,type,date,shares,price,fees,notes
AHCL,BUY,2024-05-01,13322,14,28,First buy
MEBL,BUY,2024-06-10,450,480,324,
HUBC,DIVIDEND,2025-03-25,591,5,1,Q3 FY25`;

export function ImportView() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(f: File | undefined) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  async function doPreview() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/transactions/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, dryRun: true }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.detail ?? d?.error ?? "Preview failed.");
        setPreview(null);
        return;
      }
      setPreview(d);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, dryRun: false }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.detail ?? d?.error ?? "Import failed.");
        return;
      }
      setResult(`Imported ${d.imported} transactions across ${d.symbols?.length ?? 0} symbols.`);
      setPreview(null);
      setCsv("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="label-cap">Paste CSV or upload a file</div>
          <div className="flex gap-3">
            <button onClick={() => setCsv(SAMPLE)} className="font-mono text-[10px] uppercase tracking-button hover:underline" style={{ color: "var(--accent-deep)" }}>
              Load sample
            </button>
            <button onClick={() => fileRef.current?.click()} className="font-mono text-[10px] uppercase tracking-button hover:underline" style={{ color: "var(--accent-deep)" }}>
              Upload .csv
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={10}
          placeholder="symbol,type,date,shares,price,fees,notes"
          className="w-full bg-transparent border border-rule p-3 font-mono text-[12px] focus:outline-none focus:border-ink resize-y"
        />
        <div className="flex items-center gap-3 mt-3">
          <Button variant="outline" onClick={doPreview} disabled={busy || !csv.trim()}>
            {busy ? "…" : "Preview"}
          </Button>
          {preview && (
            <Button variant="solid" onClick={doImport} disabled={busy || preview.total === 0}>
              Import {preview.total}
            </Button>
          )}
          {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
          {result && <span className="text-[13px]" style={{ color: "var(--positive)" }}>{result}</span>}
        </div>
      </Card>

      {preview && (
        <Card>
          <div className="label-cap mb-2">
            {preview.total} valid rows{preview.errors.length > 0 ? ` · ${preview.errors.length} skipped` : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono mono-num">
              <thead>
                <tr className="border-t border-b border-ink text-left">
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Date</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Symbol</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px]">Type</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Shares</th>
                  <th className="px-2 py-1.5 uppercase tracking-stat text-muted text-[10px] text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((r, i) => (
                  <tr key={i} className="border-b border-rule">
                    <td className="px-2 py-1.5">{r.date}</td>
                    <td className="px-2 py-1.5 font-medium">{r.symbol}</td>
                    <td className="px-2 py-1.5">{r.type}</td>
                    <td className="px-2 py-1.5 text-right">{r.shares}</td>
                    <td className="px-2 py-1.5 text-right">{r.pricePerShare}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.errors.length > 0 && (
            <div className="mt-3 text-[11px] text-muted">
              Skipped: {preview.errors.slice(0, 5).map((e) => `line ${e.line}`).join(", ")}
              {preview.errors.length > 5 ? "…" : ""}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
