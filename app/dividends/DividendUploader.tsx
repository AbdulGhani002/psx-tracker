"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { fmtRs, fmtNum, fmtDate } from "@/lib/format";

type ParsedWarrant = {
  warrantNo: string | null;
  companyName: string | null;
  shares: number | null;
  ratePerSecurity: number | null;
  grossAmount: number | null;
  taxDeducted: number | null;
  zakatDeducted: number | null;
  amountPaid: number | null;
  paymentDate: string | null;
  issueDate: string | null;
  financialYear: string | null;
  dividendType: string | null;
  paymentStatus: string | null;
};

type Pending = {
  filename: string;
  parsed?: ParsedWarrant;
  error?: string;
  symbol: string; // chosen / typed
  isCustom: boolean;
  customSymbol: string;
  imported?: boolean;
  duplicate?: boolean;
  importError?: string;
};

function suggestSymbolLocal(
  companyName: string | null,
  existing: Array<{ symbol: string; name: string }>
): string | null {
  if (!companyName) return null;
  const lower = companyName.toLowerCase();
  let best: { symbol: string; score: number } | null = null;
  for (const h of existing) {
    const hn = (h.name ?? "").toLowerCase();
    let score = 0;
    for (const word of hn.split(/[^a-z]+/).filter((w) => w.length > 3)) {
      if (lower.includes(word)) score += word.length;
    }
    if (!best || score > best.score) best = { symbol: h.symbol, score };
  }
  return best && best.score >= 6 ? best.symbol : null;
}

type Props = {
  existingSymbols: Array<{ symbol: string; name: string }>;
  existingWarrantNumbers: string[];
};

export function DividendUploader({ existingSymbols, existingWarrantNumbers }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const knownWarrantSet = new Set(existingWarrantNumbers);

  async function handleFiles(files: FileList | null | File[]) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (arr.length === 0) return;
    setParsing(true);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("files", f);
      const res = await fetch("/api/dividends/parse", { method: "POST", body: fd });
      const json = await res.json();
      const next: Pending[] = (json.results ?? []).map((r: any) => {
        const parsed: ParsedWarrant | undefined = r.parsed;
        const suggested = parsed
          ? suggestSymbolLocal(parsed.companyName, existingSymbols)
          : null;
        const initialSymbol = suggested ?? existingSymbols[0]?.symbol ?? "__new__";
        return {
          filename: r.filename,
          parsed,
          error: r.error,
          symbol: initialSymbol,
          isCustom: initialSymbol === "__new__",
          customSymbol: "",
        };
      });
      setPending((prev) => [...prev, ...next]);
    } finally {
      setParsing(false);
    }
  }

  function updateRow(i: number, patch: Partial<Pending>) {
    setPending((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function importAll() {
    setImporting(true);
    try {
      const items = pending
        .filter((p) => p.parsed && !p.imported && !p.duplicate && p.parsed.warrantNo)
        .map((p) => {
          const symbol = (p.isCustom ? p.customSymbol : p.symbol).trim().toUpperCase();
          return {
            symbol,
            warrantNo: p.parsed!.warrantNo!,
            companyName: p.parsed!.companyName,
            shares: p.parsed!.shares ?? 0,
            ratePerSecurity: p.parsed!.ratePerSecurity ?? 0,
            grossAmount: p.parsed!.grossAmount ?? 0,
            taxDeducted: p.parsed!.taxDeducted ?? 0,
            zakatDeducted: p.parsed!.zakatDeducted ?? 0,
            amountPaid: p.parsed!.amountPaid ?? 0,
            paymentDate: p.parsed!.paymentDate ?? p.parsed!.issueDate ?? new Date().toISOString(),
            financialYear: p.parsed!.financialYear,
            dividendType: p.parsed!.dividendType,
          };
        })
        .filter((it) => it.symbol);

      if (items.length === 0) {
        setImporting(false);
        return;
      }

      const res = await fetch("/api/dividends/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      const importedSet = new Set(
        (json.imported ?? []).map((x: any) => x.warrantNo)
      );
      const dupSet = new Set((json.duplicates ?? []).map((x: any) => x.warrantNo));
      const errMap = new Map(
        (json.errors ?? []).map((x: any) => [x.warrantNo, x.error])
      );

      setPending((rs) =>
        rs.map((p) => {
          const wn = p.parsed?.warrantNo;
          if (!wn) return p;
          if (importedSet.has(wn)) return { ...p, imported: true };
          if (dupSet.has(wn)) return { ...p, duplicate: true };
          if (errMap.has(wn)) return { ...p, importError: String(errMap.get(wn) ?? "") };
          return p;
        })
      );
      router.refresh();
    } finally {
      setImporting(false);
    }
  }

  function clearImported() {
    setPending((rs) => rs.filter((p) => !p.imported));
  }

  function clearAll() {
    setPending([]);
  }

  const importable = pending.filter(
    (p) => p.parsed && !p.imported && !p.duplicate && !knownWarrantSet.has(p.parsed.warrantNo ?? "")
  ).length;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed cursor-pointer p-10 text-center transition-colors"
        style={{
          borderColor: dragOver ? "var(--accent)" : "var(--rule)",
          background: dragOver ? "var(--paper-2)" : "transparent",
        }}
      >
        <div className="label-cap mb-2">Drop PDFs here</div>
        <p className="text-[13px] text-muted">
          or click to select files · CDC dividend warrants from{" "}
          <span className="font-mono text-[12px]">cdcpakistan.com</span> portal
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {parsing && (
        <p className="text-[12px] text-muted">Parsing PDFs…</p>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((p, i) => {
            const dupKnown = p.parsed?.warrantNo
              ? knownWarrantSet.has(p.parsed.warrantNo)
              : false;
            const finalSymbol = (p.isCustom ? p.customSymbol : p.symbol).trim().toUpperCase();

            return (
              <Card key={p.filename + i}>
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <div className="label-cap">{p.filename}</div>
                    {p.parsed?.companyName && (
                      <div
                        className="font-display mt-1"
                        style={{ fontSize: 16, fontVariationSettings: "'opsz' 144" }}
                      >
                        {p.parsed.companyName}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {p.imported && (
                      <span className="font-mono text-[11px] uppercase tracking-button" style={{ color: "var(--positive)" }}>
                        ✓ Imported
                      </span>
                    )}
                    {(p.duplicate || dupKnown) && !p.imported && (
                      <span className="font-mono text-[11px] uppercase tracking-button" style={{ color: "var(--accent-deep)" }}>
                        Already recorded
                      </span>
                    )}
                    {p.importError && (
                      <span className="font-mono text-[11px]" style={{ color: "var(--negative)" }}>
                        {p.importError.slice(0, 40)}
                      </span>
                    )}
                  </div>
                </div>

                {p.error && (
                  <p className="text-[12px]" style={{ color: "var(--negative)" }}>
                    Parse failed: {p.error}
                  </p>
                )}

                {p.parsed && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-[12px] font-mono mono-num">
                      <Field label="Warrant #" value={p.parsed.warrantNo} />
                      <Field label="Shares" value={p.parsed.shares != null ? fmtNum(p.parsed.shares) : null} />
                      <Field label="Rate/Share" value={p.parsed.ratePerSecurity != null ? fmtRs(p.parsed.ratePerSecurity, true) : null} />
                      <Field label="Gross" value={p.parsed.grossAmount != null ? fmtRs(p.parsed.grossAmount) : null} />
                      <Field label="Tax" value={p.parsed.taxDeducted != null ? fmtRs(p.parsed.taxDeducted) : null} />
                      <Field label="Zakat" value={p.parsed.zakatDeducted != null ? fmtRs(p.parsed.zakatDeducted) : null} />
                      <Field label="Net Paid" value={p.parsed.amountPaid != null ? fmtRs(p.parsed.amountPaid) : null} highlight />
                      <Field label="Paid On" value={p.parsed.paymentDate ? fmtDate(p.parsed.paymentDate) : null} />
                      <Field label="FY" value={p.parsed.financialYear} />
                      <Field label="Type" value={p.parsed.dividendType} />
                    </div>

                    {!p.imported && !p.duplicate && !dupKnown && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-3 border-t border-rule">
                        <Select
                          label="PSX Symbol"
                          value={p.symbol}
                          onChange={(v) => updateRow(i, { symbol: v, isCustom: v === "__new__" })}
                          options={[
                            ...existingSymbols.map((s) => ({ value: s.symbol, label: `${s.symbol} — ${s.name}` })),
                            { value: "__new__", label: "+ Add new symbol" },
                          ]}
                        />
                        {p.isCustom && (
                          <div className="space-y-1.5">
                            <label className="label-cap block">New symbol</label>
                            <div className="border-b border-ink">
                              <input
                                type="text"
                                value={p.customSymbol}
                                onChange={(e) => updateRow(i, { customSymbol: e.target.value.toUpperCase() })}
                                placeholder="e.g. HUBC"
                                className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono"
                              />
                            </div>
                            <p className="text-[11px] text-muted">
                              We&apos;ll fetch the name + sector from PSX on import.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Card>
            );
          })}

          <div className="flex flex-wrap gap-3 items-center pt-2">
            <Button
              variant="solid"
              onClick={importAll}
              disabled={importing || importable === 0}
            >
              {importing ? "Importing…" : `Import ${importable} new`}
            </Button>
            <Button variant="outline" onClick={clearImported}>
              Clear imported
            </Button>
            <Button variant="ghost" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, highlight = false }: { label: string; value: string | number | null | undefined; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] tracking-stat uppercase text-muted">{label}</div>
      <div
        style={{
          color: highlight ? "var(--positive)" : "var(--ink)",
          fontWeight: highlight ? 500 : 400,
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
