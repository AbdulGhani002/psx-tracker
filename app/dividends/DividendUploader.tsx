"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";
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

// Words too generic to be a useful match signal on their own. Almost every PSX
// listing has "limited", "company", or "pakistan" in its full name.
const SYMBOL_MATCH_STOPWORDS = new Set([
  "limited", "ltd", "company", "co", "corporation", "corp", "pakistan",
  "bank", "the", "of", "and", "for", "national", "international",
]);

function meaningfulWords(name: string): string[] {
  return (name ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !SYMBOL_MATCH_STOPWORDS.has(w));
}

function suggestSymbolLocal(
  companyName: string | null,
  existing: Array<{ symbol: string; name: string }>
): string | null {
  if (!companyName) return null;
  const docWords = new Set(meaningfulWords(companyName));
  if (docWords.size === 0) return null;
  let best: { symbol: string; score: number; matches: number } | null = null;
  for (const h of existing) {
    const holdingWords = meaningfulWords(h.name);
    let score = 0;
    let matches = 0;
    for (const word of holdingWords) {
      if (docWords.has(word)) {
        matches++;
        score += word.length;
      }
    }
    if (!best || score > best.score) best = { symbol: h.symbol, score, matches };
  }
  // Require at least one strong meaningful-word overlap. Without that we'd
  // wrongly snap NBP -> PPL because both names contain "Pakistan".
  if (!best || best.matches === 0 || best.score < 5) return null;
  return best.symbol;
}

type Props = {
  existingSymbols: Array<{ symbol: string; name: string }>;
  existingWarrantNumbers: string[];
};

type ManualForm = {
  symbol: string;
  isCustom: boolean;
  customSymbol: string;
  warrantNo: string;
  shares: number;
  ratePerSecurity: number;
  taxDeducted: number;
  zakatDeducted: number;
  paymentDate: string;
  financialYear: string;
  dividendType: string;
};

export function DividendUploader({ existingSymbols, existingWarrantNumbers }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSavedAt, setManualSavedAt] = useState<number | null>(null);
  const [manual, setManual] = useState<ManualForm>({
    symbol: existingSymbols[0]?.symbol ?? "__new__",
    isCustom: existingSymbols.length === 0,
    customSymbol: "",
    warrantNo: "",
    shares: 0,
    ratePerSecurity: 0,
    taxDeducted: 0,
    zakatDeducted: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    financialYear: "",
    dividendType: "Interim",
  });

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

  function updateParsed(i: number, patch: Partial<ParsedWarrant>) {
    setPending((rs) =>
      rs.map((r, idx) =>
        idx === i && r.parsed ? { ...r, parsed: { ...r.parsed, ...patch } } : r
      )
    );
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

  const manualSymbol = (manual.isCustom ? manual.customSymbol : manual.symbol).trim().toUpperCase();
  const manualGross = manual.shares * manual.ratePerSecurity;
  const manualNet = manualGross - manual.taxDeducted - manual.zakatDeducted;

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    if (!manualSymbol) { setManualError("Pick or type a symbol."); return; }
    if (!manual.warrantNo.trim()) { setManualError("Warrant number is required (used for dedup)."); return; }
    if (manual.shares <= 0 || manual.ratePerSecurity <= 0) {
      setManualError("Shares and rate per share must be positive.");
      return;
    }
    setManualSaving(true);
    try {
      const item = {
        symbol: manualSymbol,
        warrantNo: manual.warrantNo.trim(),
        companyName: null,
        shares: manual.shares,
        ratePerSecurity: manual.ratePerSecurity,
        grossAmount: manualGross,
        taxDeducted: manual.taxDeducted,
        zakatDeducted: manual.zakatDeducted,
        amountPaid: manualNet,
        paymentDate: manual.paymentDate,
        financialYear: manual.financialYear || null,
        dividendType: manual.dividendType || null,
      };
      const res = await fetch("/api/dividends/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [item] }),
      });
      const json = await res.json();
      if (!res.ok) {
        setManualError(json?.detail ?? json?.error ?? "Save failed.");
        return;
      }
      if (json.summary?.duplicateCount > 0) {
        setManualError("That warrant number is already recorded.");
        return;
      }
      if (json.summary?.errorCount > 0) {
        setManualError(json.errors?.[0]?.error ?? "Save failed.");
        return;
      }
      setManualSavedAt(Date.now());
      setManual((m) => ({ ...m, warrantNo: "", shares: 0, ratePerSecurity: 0, taxDeducted: 0, zakatDeducted: 0 }));
      router.refresh();
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant={showManual ? "outline" : "solid"} onClick={() => setShowManual(false)}>
          Upload PDF
        </Button>
        <Button variant={showManual ? "solid" : "outline"} onClick={() => setShowManual(true)}>
          Add Manually
        </Button>
      </div>

      {showManual ? (
        <Card>
          <form onSubmit={submitManual} className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <Select
              label="Symbol"
              value={manual.symbol}
              onChange={(v) => setManual({ ...manual, symbol: v, isCustom: v === "__new__" })}
              options={[
                ...existingSymbols.map((s) => ({ value: s.symbol, label: `${s.symbol} — ${s.name}` })),
                { value: "__new__", label: "+ Add new symbol" },
              ]}
            />
            {manual.isCustom && (
              <div className="space-y-1.5">
                <label className="label-cap block">New symbol</label>
                <div className="border-b border-ink">
                  <input
                    type="text"
                    value={manual.customSymbol}
                    onChange={(e) => setManual({ ...manual, customSymbol: e.target.value.toUpperCase() })}
                    placeholder="e.g. HUBC"
                    className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="label-cap block">Warrant # (any unique ID)</label>
              <div className="border-b border-ink">
                <input
                  type="text"
                  value={manual.warrantNo}
                  onChange={(e) => setManual({ ...manual, warrantNo: e.target.value })}
                  placeholder="e.g. MAN-2026-001 or 55017726"
                  className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono"
                />
              </div>
              <p className="text-[11px] text-muted">Required. Used to dedup; use any string you won't repeat.</p>
            </div>
            <div className="space-y-1.5">
              <label className="label-cap block">Payment date</label>
              <div className="border-b border-ink">
                <input
                  type="date"
                  value={manual.paymentDate}
                  onChange={(e) => setManual({ ...manual, paymentDate: e.target.value })}
                  className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono mono-num"
                />
              </div>
            </div>
            <NumberInput
              label="Shares at record date"
              value={manual.shares}
              onChange={(v) => setManual({ ...manual, shares: v })}
              min={0}
              step={1}
            />
            <NumberInput
              label="Rate per share (Rs)"
              value={manual.ratePerSecurity}
              onChange={(v) => setManual({ ...manual, ratePerSecurity: v })}
              min={0}
              step={0.0001}
            />
            <NumberInput
              label="Tax deducted (Rs)"
              value={manual.taxDeducted}
              onChange={(v) => setManual({ ...manual, taxDeducted: v })}
              min={0}
              step={0.01}
            />
            <NumberInput
              label="Zakat deducted (Rs)"
              value={manual.zakatDeducted}
              onChange={(v) => setManual({ ...manual, zakatDeducted: v })}
              min={0}
              step={0.01}
            />
            <div className="space-y-1.5">
              <label className="label-cap block">Financial year</label>
              <div className="border-b border-ink">
                <input
                  type="text"
                  value={manual.financialYear}
                  onChange={(e) => setManual({ ...manual, financialYear: e.target.value })}
                  placeholder="2024-25"
                  className="w-full bg-transparent py-1.5 text-[14px] focus:outline-none font-mono"
                />
              </div>
            </div>
            <Select
              label="Dividend type"
              value={manual.dividendType}
              onChange={(v) => setManual({ ...manual, dividendType: v })}
              options={[
                { value: "Interim", label: "Interim" },
                { value: "Final", label: "Final" },
                { value: "Special", label: "Special" },
                { value: "Other", label: "Other" },
              ]}
            />

            <div className="md:col-span-2 bg-[var(--paper)] -mx-6 -mb-6 px-6 py-4 border-t border-rule">
              <div className="grid grid-cols-3 gap-4 font-mono mono-num text-[13px]">
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Gross</div>
                  <div>{fmtRs(manualGross)}</div>
                </div>
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Deductions</div>
                  <div>{fmtRs(manual.taxDeducted + manual.zakatDeducted)}</div>
                </div>
                <div>
                  <div className="text-[10px] tracking-stat uppercase text-muted">Net (will be recorded)</div>
                  <div style={{ color: "var(--positive)" }}>{fmtRs(manualNet)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <Button type="submit" variant="solid" disabled={manualSaving}>
                  {manualSaving ? "Saving…" : "Record Dividend"}
                </Button>
                {manualError && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{manualError}</span>}
                {manualSavedAt && Date.now() - manualSavedAt < 3500 && (
                  <span className="text-[13px]" style={{ color: "var(--positive)" }}>Saved.</span>
                )}
              </div>
            </div>
          </form>
        </Card>
      ) : (
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
      )}

      {parsing && !showManual && (
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
                        style={{ fontSize: 16 }}
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
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-[12px]">
                      <EditableField
                        label="Warrant #"
                        value={p.parsed.warrantNo ?? ""}
                        onChange={(v) => updateParsed(i, { warrantNo: v.trim() || null })}
                        disabled={!!p.imported}
                      />
                      <EditableNumber
                        label="Shares"
                        value={p.parsed.shares}
                        onChange={(v) => updateParsed(i, { shares: v })}
                        disabled={!!p.imported}
                      />
                      <EditableNumber
                        label="Rate/Share"
                        value={p.parsed.ratePerSecurity}
                        step={0.0001}
                        onChange={(v) => updateParsed(i, { ratePerSecurity: v })}
                        disabled={!!p.imported}
                      />
                      <EditableNumber
                        label="Gross"
                        value={p.parsed.grossAmount}
                        step={0.01}
                        onChange={(v) => updateParsed(i, { grossAmount: v })}
                        disabled={!!p.imported}
                      />
                      <EditableNumber
                        label="Tax"
                        value={p.parsed.taxDeducted}
                        step={0.01}
                        onChange={(v) => updateParsed(i, { taxDeducted: v })}
                        disabled={!!p.imported}
                      />
                      <EditableNumber
                        label="Zakat"
                        value={p.parsed.zakatDeducted}
                        step={0.01}
                        onChange={(v) => updateParsed(i, { zakatDeducted: v })}
                        disabled={!!p.imported}
                      />
                      <EditableNumber
                        label="Net Paid"
                        value={p.parsed.amountPaid}
                        step={0.01}
                        onChange={(v) => updateParsed(i, { amountPaid: v })}
                        disabled={!!p.imported}
                        highlight
                      />
                      <EditableField
                        label="Paid On"
                        type="date"
                        value={p.parsed.paymentDate ?? ""}
                        onChange={(v) => updateParsed(i, { paymentDate: v || null })}
                        disabled={!!p.imported}
                      />
                      <EditableField
                        label="FY"
                        value={p.parsed.financialYear ?? ""}
                        placeholder="2024-25"
                        onChange={(v) => updateParsed(i, { financialYear: v || null })}
                        disabled={!!p.imported}
                      />
                      <EditableField
                        label="Type"
                        value={p.parsed.dividendType ?? ""}
                        placeholder="Interim / Final / Special"
                        onChange={(v) => updateParsed(i, { dividendType: v || null })}
                        disabled={!!p.imported}
                      />
                    </div>
                    <FieldHelpers
                      shares={p.parsed.shares}
                      rate={p.parsed.ratePerSecurity}
                      gross={p.parsed.grossAmount}
                      tax={p.parsed.taxDeducted}
                      zakat={p.parsed.zakatDeducted}
                      onFill={(patch) => updateParsed(i, patch)}
                      disabled={!!p.imported}
                    />

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

function EditableField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date";
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-stat uppercase text-muted">{label}</div>
      <div className="border-b border-ink mt-0.5">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-transparent text-[13px] py-1 font-mono mono-num focus:outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
}

function EditableNumber({
  label,
  value,
  onChange,
  step = 1,
  disabled,
  highlight,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  step?: number;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-stat uppercase text-muted">{label}</div>
      <div className="border-b border-ink mt-0.5">
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          step={step}
          disabled={disabled}
          className="w-full bg-transparent text-[13px] py-1 font-mono mono-num focus:outline-none disabled:opacity-60"
          style={{
            color: highlight ? "var(--positive)" : "var(--ink)",
            fontWeight: highlight ? 500 : 400,
          }}
        />
      </div>
    </div>
  );
}

function FieldHelpers({
  shares,
  rate,
  gross,
  tax,
  zakat,
  onFill,
  disabled,
}: {
  shares: number | null;
  rate: number | null;
  gross: number | null;
  tax: number | null;
  zakat: number | null;
  onFill: (patch: { grossAmount?: number; ratePerSecurity?: number; amountPaid?: number; shares?: number }) => void;
  disabled?: boolean;
}) {
  if (disabled) return null;

  const helpers: Array<{ label: string; onClick: () => void }> = [];

  if (shares && rate && (!gross || Math.abs(gross - shares * rate) > 0.01)) {
    const v = Math.round(shares * rate * 100) / 100;
    helpers.push({
      label: `Fill Gross = ${shares} × ${rate} = ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`,
      onClick: () => onFill({ grossAmount: v }),
    });
  }
  if (shares && gross && shares > 0 && (!rate || rate === 0)) {
    const v = Math.round((gross / shares) * 10000) / 10000;
    helpers.push({
      label: `Fill Rate = Gross ÷ Shares = ${v}`,
      onClick: () => onFill({ ratePerSecurity: v }),
    });
  }
  if (gross && rate && rate > 0 && (!shares || shares === 0)) {
    const v = Math.round(gross / rate);
    helpers.push({
      label: `Fill Shares = Gross ÷ Rate ≈ ${v}`,
      onClick: () => onFill({ shares: v }),
    });
  }
  if (gross != null && tax != null && zakat != null) {
    const v = Math.round((gross - tax - zakat) * 100) / 100;
    helpers.push({
      label: `Fill Net = Gross − Tax − Zakat = ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`,
      onClick: () => onFill({ amountPaid: v }),
    });
  }

  if (helpers.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {helpers.map((h, i) => (
        <button
          key={i}
          type="button"
          onClick={h.onClick}
          className="font-mono text-[10px] uppercase tracking-button border border-[var(--rule)] hover:border-ink px-2 py-1 transition-colors"
          style={{ color: "var(--accent-deep)" }}
        >
          ↳ {h.label}
        </button>
      ))}
    </div>
  );
}
